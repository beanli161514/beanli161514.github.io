/** OpenCV world-to-camera projection with the 8-parameter distortion model. */
export function project(point, camera) {
  const {R,t,K,distortion:d}=camera, [X,Y,Z]=point;
  const z=R[6]*X+R[7]*Y+R[8]*Z+t[2];
  if (!Number.isFinite(z) || z<=0) return null;
  const x=(R[0]*X+R[1]*Y+R[2]*Z+t[0])/z, y=(R[3]*X+R[4]*Y+R[5]*Z+t[1])/z;
  const r2=x*x+y*y,r4=r2*r2,r6=r4*r2;
  const radial=(1+(d[0]||0)*r2+(d[1]||0)*r4+(d[4]||0)*r6)/(1+(d[5]||0)*r2+(d[6]||0)*r4+(d[7]||0)*r6);
  const xd=x*radial+2*(d[2]||0)*x*y+(d[3]||0)*(r2+2*x*x);
  const yd=y*radial+(d[2]||0)*(r2+2*y*y)+2*(d[3]||0)*x*y;
  return [K[0]*xd+K[2],K[4]*yd+K[5]];
}
export function frameAtTime(time,fps,count){return Math.max(0,Math.min(count-1,Math.floor(time*fps+1e-5)));}
export function shapeFromCoefficients(model,coefficients){
  const result=Float32Array.from(model.mean);
  for(let p=0;p<coefficients.length;p++) for(let i=0;i<result.length;i++) result[i]+=coefficients[p]*model.modes[p][i];
  return result;
}
