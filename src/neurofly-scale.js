// Voxel coordinates refer to voxel centers. Region origins describe the first
// voxel center, while VolumeView draws its outer boundary half a voxel earlier.
export function transformXYZ(point,affine){
  return affine.slice(0,3).map(row=>row[0]*point[0]+row[1]*point[1]+row[2]*point[2]+row[3]);
}

export function physicalBox(centerXYZ,sizeMM,spacingMM){
  const size=sizeMM.map((n,i)=>n/spacingMM[i]);
  return {size,origin:centerXYZ.map((n,i)=>n-size[i]/2+.5)};
}
