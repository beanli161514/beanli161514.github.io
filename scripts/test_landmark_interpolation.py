import unittest
import numpy as np
from landmark_interpolation import interpolate_landmarks, interpolation_metadata

class InterpolationTests(unittest.TestCase):
    def test_bounded_gap_preserves_observations_and_uses_shared_xyz_weights(self):
        raw=np.array([[[0,2,4]],[[np.nan,9,9]],[[np.nan]*3],[[9,8,-2]]],np.float32)
        out,mask=interpolate_landmarks(raw)
        np.testing.assert_array_equal(out[:,0],[[0,2,4],[3,4,2],[6,6,0],[9,8,-2]])
        np.testing.assert_array_equal(raw[0],out[0]);np.testing.assert_array_equal(raw[-1],out[-1])
        self.assertEqual(interpolation_metadata(mask,1,3),dict(filledPoints=2,runs=[[0,0,2]]))
    def test_clip_boundary_uses_observations_outside_clip(self):
        raw=np.array([[[0]*3],[[np.nan]*3],[[np.nan]*3],[[3]*3]],np.float32)
        out,_=interpolate_landmarks(raw)
        np.testing.assert_array_equal(out[1:3,0],[[1]*3,[2]*3])
    def test_unbounded_and_long_gaps_are_not_invented(self):
        raw=np.full((8,2,3),np.nan,np.float32);raw[1,0]=0;raw[6,0]=10
        out,mask=interpolate_landmarks(raw,max_gap_frames=3)
        np.testing.assert_array_equal(out,raw);self.assertFalse(mask.any())

if __name__=='__main__':unittest.main()
