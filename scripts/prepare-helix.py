#!/usr/bin/env python3
"""Prepare exact indexed meshes and metadata-free photos for the Helix page.

Requires numpy, Pillow with LittleCMS, and cwebp. Source files are read-only.
Usage: python scripts/prepare-helix.py --source '/path/to/Double Helix/v2.0'
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

import numpy as np
from PIL import Image, ImageCms

ROOT = Path(__file__).resolve().parents[1]
STL_DTYPE = np.dtype([('normal', '<f4', (3,)), ('vertices', '<f4', (3, 3)), ('attribute', '<u2')])


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare_mesh(source, output, part):
    path = source / f'Double Helix {part.title()} v2.0.stl'
    original = path.read_bytes()
    count = struct.unpack_from('<I', original, 80)[0]
    if len(original) != 84 + 50 * count:
        raise ValueError(f'Unexpected binary STL size: {path.name}')
    triangles = np.frombuffer(original, dtype=STL_DTYPE, offset=84)
    positions = np.ascontiguousarray(triangles['vertices'].reshape(-1, 3), dtype='<f4')
    if not np.all(np.isfinite(positions)):
        raise ValueError('Nonfinite source geometry')
    # Group float bit patterns, retaining even signed zero exactly. No tolerance,
    # simplification, coordinate transform, smoothing, or triangle reordering.
    unique_bits, inverse = np.unique(positions.view('<u4'), axis=0, return_inverse=True)
    unique = np.ascontiguousarray(unique_bits).view('<f4')
    index_dtype = '<u2' if len(unique) <= 65535 else '<u4'
    indices = inverse.astype(index_dtype)
    assert unique[indices].tobytes() == positions.tobytes()
    low, high = positions.min(axis=0), positions.max(axis=0)
    position_bytes, index_bytes = unique.tobytes(), indices.tobytes()
    binary = position_bytes + index_bytes
    document = {
        'asset': {'version': '2.0', 'generator': 'Exact indexed STL conversion'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'name': part.title(), 'mesh': 0}],
        'meshes': [{'name': part.title(), 'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1, 'mode': 4}]}],
        'buffers': [{'byteLength': len(binary)}],
        'bufferViews': [
            {'buffer': 0, 'byteOffset': 0, 'byteLength': len(position_bytes), 'target': 34962},
            {'buffer': 0, 'byteOffset': len(position_bytes), 'byteLength': len(index_bytes), 'target': 34963},
        ],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(unique), 'type': 'VEC3',
             'min': low.tolist(), 'max': high.tolist()},
            {'bufferView': 1, 'componentType': 5123 if index_dtype == '<u2' else 5125,
             'count': len(indices), 'type': 'SCALAR', 'min': [int(indices.min())], 'max': [int(indices.max())]},
        ],
    }
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    binary += b'\0' * (-len(binary) % 4)
    total = 12 + 8 + len(encoded) + 8 + len(binary)
    glb = (struct.pack('<III', 0x46546C67, 2, total)
           + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
           + struct.pack('<II', len(binary), 0x004E4942) + binary)
    glb_path = output / f'{part}.glb'
    glb_path.write_bytes(glb)
    # Keep every original STL facet byte; replace only the non-geometric header.
    stl_path = output / f'{part}.stl'
    stl_path.write_bytes(f'Double Helix {part.title()} v2.0'.encode().ljust(80, b'\0') + original[80:])
    assert stl_path.read_bytes()[80:] == original[80:]
    # Independently unpack the delivered GLB and compare every triangle bitwise.
    delivered = glb_path.read_bytes()
    json_length = struct.unpack_from('<I', delivered, 12)[0]
    meta = json.loads(delivered[20:20 + json_length])
    binary_start = 20 + json_length + 8
    p = meta['bufferViews'][0]
    i = meta['bufferViews'][1]
    read_positions = np.frombuffer(delivered, dtype='<f4', count=p['byteLength'] // 4,
                                   offset=binary_start + p['byteOffset']).reshape(-1, 3)
    read_indices = np.frombuffer(delivered, dtype=index_dtype, count=meta['accessors'][1]['count'],
                                offset=binary_start + i['byteOffset'])
    assert read_positions[read_indices].tobytes() == positions.tobytes()
    return {
        'id': part, 'viewer': glb_path.name, 'download': stl_path.name,
        'triangleCount': count, 'indexedVertexCount': len(unique),
        'bounds': {'min': low.tolist(), 'max': high.tolist()},
        'dimensions': (high.astype(float) - low).tolist(),
        'center': ((low.astype(float) + high) / 2).tolist(),
        'coordinateUnits': 'Original STL units; the source format specifies no physical unit.',
        'viewerBytes': glb_path.stat().st_size, 'downloadBytes': stl_path.stat().st_size,
        'viewerSHA256': sha256(glb_path), 'downloadSHA256': sha256(stl_path),
        'sourceSHA256': hashlib.sha256(original).hexdigest(),
        'geometrySHA256': hashlib.sha256(positions.tobytes()).hexdigest(),
        'geometryPreservation': 'Every original triangle coordinate bit pattern and winding retained; no geometric transformation or simplification.',
        'normals': 'Normal attribute omitted. GLTFLoader uses flat shading derived from the exact triangle surfaces.',
    }


def discover_photos(source):
    photos = [(int(match.group(1)), path) for path in source.iterdir()
              if path.is_file() and (match := re.fullmatch(r'photo([0-9]+)\.jpeg', path.name))]
    return [path for _, path in sorted(photos, key=lambda item: (item[0], item[1].name))]


def prepare_photo(path, output, cwebp):
    with tempfile.TemporaryDirectory(prefix='helix-photo-') as temp:
        converted = Path(temp) / 'srgb.png'
        # Convert tagged photos before stripping their profile. Untagged JPEGs
        # use the standard sRGB assumption rather than requiring optional ICC.
        with Image.open(path) as image:
            if image.format not in {'JPEG', 'MPO'}:
                raise ValueError(f'Expected JPEG photo: {path.name}')
            original_size = list(image.size)
            if image.getexif().get(274, 1) != 1:
                raise ValueError('Inspect non-upright photo orientation before exporting')
            profile = image.info.get('icc_profile')
            if profile:
                source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile))
                srgb = ImageCms.profileToProfile(image, source_profile, ImageCms.createProfile('sRGB'), outputMode='RGB')
            else:
                srgb = image.convert('RGB')
            reference_mean = np.asarray(srgb).mean()
            srgb.save(converted)
        target = output / (path.stem + '.webp')
        resize = []
        if max(original_size) > 1920:
            resize = ['-resize', '1920', '0'] if original_size[0] >= original_size[1] else ['-resize', '0', '1920']
        subprocess.run([cwebp, '-quiet', '-q', '86', '-m', '6', '-sharp_yuv', '-metadata', 'none',
                        *resize, str(converted), '-o', str(target)], check=True)
    with Image.open(target) as image:
        assert image.format == 'WEBP'
        assert not image.getexif() and not image.info.get('icc_profile') and not image.info.get('xmp')
        width, height = image.size
        assert abs(float(np.asarray(image).mean()) - reference_mean) < 3, 'Unexpected image luminance change'
    return {'file': target.name, 'width': width, 'height': height, 'bytes': target.stat().st_size,
            'sha256': sha256(target), 'colorSpace': 'sRGB', 'metadata': 'EXIF, ICC and XMP removed'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--out', type=Path, default=ROOT / 'public' / 'helix')
    parser.add_argument('--cwebp', default=shutil.which('cwebp'))
    args = parser.parse_args()
    source, output = args.source.resolve(), args.out.resolve()
    if source == output:
        raise ValueError('Source and output directories must differ')
    if not args.cwebp:
        raise ValueError('cwebp is required')
    output.mkdir(parents=True, exist_ok=True)
    meshes = [prepare_mesh(source, output, part) for part in ['body', 'cap']]
    photos = [prepare_photo(path, output, args.cwebp) for path in discover_photos(source)]
    manifest = {'schemaVersion': 1, 'meshes': meshes, 'photos': photos,
                'sourceCoordinateSystem': 'Unmodified XYZ from the supplied STL files; body long axis is +Z.',
                'assembly': 'Components retained in their authored separate positions; no assembled transform is asserted.'}
    (output / 'assets.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'meshes': [{key: mesh[key] for key in ['id', 'triangleCount', 'indexedVertexCount', 'dimensions', 'center', 'viewerBytes', 'downloadBytes']} for mesh in meshes],
                      'photos': photos}, indent=2))


if __name__ == '__main__':
    main()
