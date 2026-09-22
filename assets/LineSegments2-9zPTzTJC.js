import{az as je,al as be,aA as le,a2 as P,aB as Ne,aa as fe,ab as Me,g as U,ao as Ge,aC as $,aD as Be,V as Ve,aE as K,E as ke,aF as G,aG as qe,f as Xe,X as Je}from"./OrbitControls-XMzdh5ns.js";var w=Uint8Array,F=Uint16Array,$e=Int32Array,De=new w([0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0,0,0,0]),Le=new w([0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13,0,0]),Ke=new w([16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15]),Te=function(n,e){for(var t=new F(31),i=0;i<31;++i)t[i]=e+=1<<n[i-1];for(var r=new $e(t[30]),i=1;i<30;++i)for(var l=t[i];l<t[i+1];++l)r[l]=l-t[i]<<5|i;return{b:t,r}},Ce=Te(De,2),Oe=Ce.b,Qe=Ce.r;Oe[28]=258,Qe[258]=28;var Ye=Te(Le,0),Ze=Ye.b,ce=new F(32768);for(var c=0;c<32768;++c){var L=(c&43690)>>1|(c&21845)<<1;L=(L&52428)>>2|(L&13107)<<2,L=(L&61680)>>4|(L&3855)<<4,ce[c]=((L&65280)>>8|(L&255)<<8)>>1}var N=(function(n,e,t){for(var i=n.length,r=0,l=new F(e);r<i;++r)n[r]&&++l[n[r]-1];var f=new F(e);for(r=1;r<e;++r)f[r]=f[r-1]+l[r-1]<<1;var o;if(t){o=new F(1<<e);var u=15-e;for(r=0;r<i;++r)if(n[r])for(var g=r<<4|n[r],d=e-n[r],a=f[n[r]-1]++<<d,s=a|(1<<d)-1;a<=s;++a)o[ce[a]>>u]=g}else for(o=new F(i),r=0;r<i;++r)n[r]&&(o[r]=ce[f[n[r]-1]++]>>15-n[r]);return o}),V=new w(288);for(var c=0;c<144;++c)V[c]=8;for(var c=144;c<256;++c)V[c]=9;for(var c=256;c<280;++c)V[c]=7;for(var c=280;c<288;++c)V[c]=8;var Pe=new w(32);for(var c=0;c<32;++c)Pe[c]=5;var et=N(V,9,1),tt=N(Pe,5,1),ie=function(n){for(var e=n[0],t=1;t<n.length;++t)n[t]>e&&(e=n[t]);return e},x=function(n,e,t){var i=e/8|0;return(n[i]|n[i+1]<<8)>>(e&7)&t},re=function(n,e){var t=e/8|0;return(n[t]|n[t+1]<<8|n[t+2]<<16)>>(e&7)},nt=function(n){return(n+7)/8|0},it=function(n,e,t){return(t==null||t>n.length)&&(t=n.length),new w(n.subarray(e,t))},rt=["unexpected EOF","invalid block type","invalid length/literal","invalid distance","stream finished","no stream handler",,"no callback","invalid UTF-8 data","extra field too long","date not in range 1980-2099","filename too long","stream finishing","invalid zip data"],b=function(n,e,t){var i=new Error(e||rt[n]);if(i.code=n,Error.captureStackTrace&&Error.captureStackTrace(i,b),!t)throw i;return i},at=function(n,e,t,i){var r=n.length,l=0;if(!r||e.f&&!e.l)return t||new w(0);var f=!t,o=f||e.i!=2,u=e.i;f&&(t=new w(r*3));var g=function(ye){var Se=t.length;if(ye>Se){var xe=new w(Math.max(Se*2,ye));xe.set(t),t=xe}},d=e.f||0,a=e.p||0,s=e.b||0,A=e.l,W=e.d,M=e.m,B=e.n,I=r*8;do{if(!A){d=x(n,a,1);var H=x(n,a+1,3);if(a+=3,H)if(H==1)A=et,W=tt,M=9,B=5;else if(H==2){var Y=x(n,a,31)+257,de=x(n,a+10,15)+4,ue=Y+x(n,a+5,31)+1;a+=14;for(var R=new w(ue),Z=new w(19),y=0;y<de;++y)Z[Ke[y]]=x(n,a+y*3,7);a+=de*3;for(var pe=ie(Z),Fe=(1<<pe)-1,We=N(Z,pe,1),y=0;y<ue;){var ve=We[x(n,a,Fe)];a+=ve&15;var p=ve>>4;if(p<16)R[y++]=p;else{var C=0,k=0;for(p==16?(k=3+x(n,a,3),a+=2,C=R[y-1]):p==17?(k=3+x(n,a,7),a+=3):p==18&&(k=11+x(n,a,127),a+=7);k--;)R[y++]=C}}var he=R.subarray(0,Y),D=R.subarray(Y);M=ie(he),B=ie(D),A=N(he,M,1),W=N(D,B,1)}else b(1);else{var p=nt(a)+4,S=n[p-4]|n[p-3]<<8,Q=p+S;if(Q>r){u&&b(0);break}o&&g(s+S),t.set(n.subarray(p,Q),s),e.b=s+=S,e.p=a=Q*8,e.f=d;continue}if(a>I){u&&b(0);break}}o&&g(s+131072);for(var Ie=(1<<M)-1,He=(1<<B)-1,ee=a;;ee=a){var C=A[re(n,a)&Ie],O=C>>4;if(a+=C&15,a>I){u&&b(0);break}if(C||b(2),O<256)t[s++]=O;else if(O==256){ee=a,A=null;break}else{var me=O-254;if(O>264){var y=O-257,j=De[y];me=x(n,a,(1<<j)-1)+Oe[y],a+=j}var te=W[re(n,a)&He],ne=te>>4;te||b(3),a+=te&15;var D=Ze[ne];if(ne>3){var j=Le[ne];D+=re(n,a)&(1<<j)-1,a+=j}if(a>I){u&&b(0);break}o&&g(s+131072);var ge=s+me;if(s<D){var we=l-D,Re=Math.min(D,ge);for(we+s<0&&b(3);s<Re;++s)t[s]=i[we+s]}for(;s<ge;++s)t[s]=t[s-D]}}e.l=A,e.p=ee,e.b=s,e.f=d,A&&(d=1,e.m=M,e.d=W,e.n=B)}while(!d);return s!=t.length&&f?it(t,0,s):t.subarray(0,s)},ot=new w(0),st=function(n){(n[0]!=31||n[1]!=139||n[2]!=8)&&b(6,"invalid gzip data");var e=n[3],t=10;e&4&&(t+=(n[10]|n[11]<<8)+2);for(var i=(e>>3&1)+(e>>4&1);i>0;i-=!n[t++]);return t+(e&2)},lt=function(n){var e=n.length;return(n[e-4]|n[e-3]<<8|n[e-2]<<16|n[e-1]<<24)>>>0};function mt(n,e){var t=st(n);return t+8>n.length&&b(6,"invalid gzip data"),at(n.subarray(t,-8),{i:2},new w(lt(n)),e)}var ct=typeof TextDecoder<"u"&&new TextDecoder,ft=0;try{ct.decode(ot,{stream:!0}),ft=1}catch{}const _e=new fe,q=new U;class dt extends je{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],i=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(i),this.setAttribute("position",new be(e,3)),this.setAttribute("uv",new be(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,i=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),i.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const i=new le(t,6,1);return this.setAttribute("instanceStart",new P(i,3,0)),this.setAttribute("instanceEnd",new P(i,3,3)),this.instanceCount=this.attributes.instanceStart.count,this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const i=new le(t,6,1);return this.setAttribute("instanceColorStart",new P(i,3,0)),this.setAttribute("instanceColorEnd",new P(i,3,3)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new Ne(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new fe);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),_e.setFromBufferAttribute(t),this.boundingBox.union(_e))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Me),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const i=this.boundingSphere.center;this.boundingBox.getCenter(i);let r=0;for(let l=0,f=e.count;l<f;l++)q.fromBufferAttribute(e,l),r=Math.max(r,i.distanceToSquared(q)),q.fromBufferAttribute(t,l),r=Math.max(r,i.distanceToSquared(q));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}}K.line={worldUnits:{value:1},linewidth:{value:1},resolution:{value:new Ve(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}};$.line={uniforms:Be.merge([K.common,K.fog,K.line]),vertexShader:`
		#include <common>
		#include <color_pars_vertex>
		#include <fog_pars_vertex>
		#include <logdepthbuf_pars_vertex>
		#include <clipping_planes_pars_vertex>

		uniform float linewidth;
		uniform vec2 resolution;

		attribute vec3 instanceStart;
		attribute vec3 instanceEnd;

		attribute vec3 instanceColorStart;
		attribute vec3 instanceColorEnd;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#ifdef USE_DASH

			uniform float dashScale;
			attribute float instanceDistanceStart;
			attribute float instanceDistanceEnd;
			varying float vLineDistance;

		#endif

		void trimSegment( const in vec4 start, inout vec4 end ) {

			// trim end segment so it terminates between the camera plane and the near plane

			// conservative estimate of the near plane
			float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
			float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
			float nearEstimate = - 0.5 * b / a;

			float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

			end.xyz = mix( start.xyz, end.xyz, alpha );

		}

		void main() {

			#ifdef USE_COLOR

				vColor.xyz = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

			#endif

			#ifdef USE_DASH

				vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
				vUv = uv;

			#endif

			float aspect = resolution.x / resolution.y;

			// camera space
			vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
			vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

			#ifdef WORLD_UNITS

				worldStart = start.xyz;
				worldEnd = end.xyz;

			#else

				vUv = uv;

			#endif

			// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
			// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
			// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
			// perhaps there is a more elegant solution -- WestLangley

			bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

			if ( perspective ) {

				if ( start.z < 0.0 && end.z >= 0.0 ) {

					trimSegment( start, end );

				} else if ( end.z < 0.0 && start.z >= 0.0 ) {

					trimSegment( end, start );

				}

			}

			// clip space
			vec4 clipStart = projectionMatrix * start;
			vec4 clipEnd = projectionMatrix * end;

			// ndc space
			vec3 ndcStart = clipStart.xyz / clipStart.w;
			vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

			// direction
			vec2 dir = ndcEnd.xy - ndcStart.xy;

			// account for clip-space aspect ratio
			dir.x *= aspect;
			dir = normalize( dir );

			#ifdef WORLD_UNITS

				vec3 worldDir = normalize( end.xyz - start.xyz );
				vec3 tmpFwd = normalize( mix( start.xyz, end.xyz, 0.5 ) );
				vec3 worldUp = normalize( cross( worldDir, tmpFwd ) );
				vec3 worldFwd = cross( worldDir, worldUp );
				worldPos = position.y < 0.5 ? start: end;

				// height offset
				float hw = linewidth * 0.5;
				worldPos.xyz += position.x < 0.0 ? hw * worldUp : - hw * worldUp;

				// don't extend the line if we're rendering dashes because we
				// won't be rendering the endcaps
				#ifndef USE_DASH

					// cap extension
					worldPos.xyz += position.y < 0.5 ? - hw * worldDir : hw * worldDir;

					// add width to the box
					worldPos.xyz += worldFwd * hw;

					// endcaps
					if ( position.y > 1.0 || position.y < 0.0 ) {

						worldPos.xyz -= worldFwd * 2.0 * hw;

					}

				#endif

				// project the worldpos
				vec4 clip = projectionMatrix * worldPos;

				// shift the depth of the projected points so the line
				// segments overlap neatly
				vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
				clip.z = clipPose.z * clip.w;

			#else

				vec2 offset = vec2( dir.y, - dir.x );
				// undo aspect ratio adjustment
				dir.x /= aspect;
				offset.x /= aspect;

				// sign flip
				if ( position.x < 0.0 ) offset *= - 1.0;

				// endcaps
				if ( position.y < 0.0 ) {

					offset += - dir;

				} else if ( position.y > 1.0 ) {

					offset += dir;

				}

				// adjust for linewidth
				offset *= linewidth;

				// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
				offset /= resolution.y;

				// select end
				vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

				// back to clip space
				offset *= clip.w;

				clip.xy += offset;

			#endif

			gl_Position = clip;

			vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

			#include <logdepthbuf_vertex>
			#include <clipping_planes_vertex>
			#include <fog_vertex>

		}
		`,fragmentShader:`
		uniform vec3 diffuse;
		uniform float opacity;
		uniform float linewidth;

		#ifdef USE_DASH

			uniform float dashOffset;
			uniform float dashSize;
			uniform float gapSize;

		#endif

		varying float vLineDistance;

		#ifdef WORLD_UNITS

			varying vec4 worldPos;
			varying vec3 worldStart;
			varying vec3 worldEnd;

			#ifdef USE_DASH

				varying vec2 vUv;

			#endif

		#else

			varying vec2 vUv;

		#endif

		#include <common>
		#include <color_pars_fragment>
		#include <fog_pars_fragment>
		#include <logdepthbuf_pars_fragment>
		#include <clipping_planes_pars_fragment>

		vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

			float mua;
			float mub;

			vec3 p13 = p1 - p3;
			vec3 p43 = p4 - p3;

			vec3 p21 = p2 - p1;

			float d1343 = dot( p13, p43 );
			float d4321 = dot( p43, p21 );
			float d1321 = dot( p13, p21 );
			float d4343 = dot( p43, p43 );
			float d2121 = dot( p21, p21 );

			float denom = d2121 * d4343 - d4321 * d4321;

			float numer = d1343 * d4321 - d1321 * d4343;

			mua = numer / denom;
			mua = clamp( mua, 0.0, 1.0 );
			mub = ( d1343 + d4321 * ( mua ) ) / d4343;
			mub = clamp( mub, 0.0, 1.0 );

			return vec2( mua, mub );

		}

		void main() {

			float alpha = opacity;
			vec4 diffuseColor = vec4( diffuse, alpha );

			#include <clipping_planes_fragment>

			#ifdef USE_DASH

				if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

				if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

			#endif

			#ifdef WORLD_UNITS

				// Find the closest points on the view ray and the line segment
				vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
				vec3 lineDir = worldEnd - worldStart;
				vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

				vec3 p1 = worldStart + lineDir * params.x;
				vec3 p2 = rayEnd * params.y;
				vec3 delta = p1 - p2;
				float len = length( delta );
				float norm = len / linewidth;

				#ifndef USE_DASH

					#ifdef USE_ALPHA_TO_COVERAGE

						float dnorm = fwidth( norm );
						alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

					#else

						if ( norm > 0.5 ) {

							discard;

						}

					#endif

				#endif

			#else

				#ifdef USE_ALPHA_TO_COVERAGE

					// artifacts appear on some hardware if a derivative is taken within a conditional
					float a = vUv.x;
					float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
					float len2 = a * a + b * b;
					float dlen = fwidth( len2 );

					if ( abs( vUv.y ) > 1.0 ) {

						alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

					}

				#else

					if ( abs( vUv.y ) > 1.0 ) {

						float a = vUv.x;
						float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
						float len2 = a * a + b * b;

						if ( len2 > 1.0 ) discard;

					}

				#endif

			#endif

			#include <logdepthbuf_fragment>
			#include <color_fragment>

			gl_FragColor = vec4( diffuseColor.rgb, alpha );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>
			#include <fog_fragment>
			#include <premultiplied_alpha_fragment>

		}
		`};class ut extends Ge{constructor(e){super({type:"LineMaterial",uniforms:Be.clone($.line.uniforms),vertexShader:$.line.vertexShader,fragmentShader:$.line.fragmentShader,clipping:!0}),this.isLineMaterial=!0,this.setValues(e)}get color(){return this.uniforms.diffuse.value}set color(e){this.uniforms.diffuse.value=e}get worldUnits(){return"WORLD_UNITS"in this.defines}set worldUnits(e){e===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}get linewidth(){return this.uniforms.linewidth.value}set linewidth(e){this.uniforms.linewidth&&(this.uniforms.linewidth.value=e)}get dashed(){return"USE_DASH"in this.defines}set dashed(e){e===!0!==this.dashed&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}get dashScale(){return this.uniforms.dashScale.value}set dashScale(e){this.uniforms.dashScale.value=e}get dashSize(){return this.uniforms.dashSize.value}set dashSize(e){this.uniforms.dashSize.value=e}get dashOffset(){return this.uniforms.dashOffset.value}set dashOffset(e){this.uniforms.dashOffset.value=e}get gapSize(){return this.uniforms.gapSize.value}set gapSize(e){this.uniforms.gapSize.value=e}get opacity(){return this.uniforms.opacity.value}set opacity(e){this.uniforms&&(this.uniforms.opacity.value=e)}get resolution(){return this.uniforms.resolution.value}set resolution(e){this.uniforms.resolution.value.copy(e)}get alphaToCoverage(){return"USE_ALPHA_TO_COVERAGE"in this.defines}set alphaToCoverage(e){this.defines&&(e===!0!==this.alphaToCoverage&&(this.needsUpdate=!0),e===!0?this.defines.USE_ALPHA_TO_COVERAGE="":delete this.defines.USE_ALPHA_TO_COVERAGE)}}const ae=new G,Ee=new U,ze=new U,v=new G,h=new G,_=new G,oe=new U,se=new Xe,m=new qe,Ae=new U,X=new fe,J=new Me,E=new G;let z,T;function Ue(n,e,t){return E.set(0,0,-e,1).applyMatrix4(n.projectionMatrix),E.multiplyScalar(1/E.w),E.x=T/t.width,E.y=T/t.height,E.applyMatrix4(n.projectionMatrixInverse),E.multiplyScalar(1/E.w),Math.abs(Math.max(E.x,E.y))}function pt(n,e){const t=n.matrixWorld,i=n.geometry,r=i.attributes.instanceStart,l=i.attributes.instanceEnd,f=Math.min(i.instanceCount,r.count);for(let o=0,u=f;o<u;o++){m.start.fromBufferAttribute(r,o),m.end.fromBufferAttribute(l,o),m.applyMatrix4(t);const g=new U,d=new U;z.distanceSqToSegment(m.start,m.end,d,g),d.distanceTo(g)<T*.5&&e.push({point:d,pointOnLine:g,distance:z.origin.distanceTo(d),object:n,face:null,faceIndex:o,uv:null,uv1:null})}}function vt(n,e,t){const i=e.projectionMatrix,l=n.material.resolution,f=n.matrixWorld,o=n.geometry,u=o.attributes.instanceStart,g=o.attributes.instanceEnd,d=Math.min(o.instanceCount,u.count),a=-e.near;z.at(1,_),_.w=1,_.applyMatrix4(e.matrixWorldInverse),_.applyMatrix4(i),_.multiplyScalar(1/_.w),_.x*=l.x/2,_.y*=l.y/2,_.z=0,oe.copy(_),se.multiplyMatrices(e.matrixWorldInverse,f);for(let s=0,A=d;s<A;s++){if(v.fromBufferAttribute(u,s),h.fromBufferAttribute(g,s),v.w=1,h.w=1,v.applyMatrix4(se),h.applyMatrix4(se),v.z>a&&h.z>a)continue;if(v.z>a){const p=v.z-h.z,S=(v.z-a)/p;v.lerp(h,S)}else if(h.z>a){const p=h.z-v.z,S=(h.z-a)/p;h.lerp(v,S)}v.applyMatrix4(i),h.applyMatrix4(i),v.multiplyScalar(1/v.w),h.multiplyScalar(1/h.w),v.x*=l.x/2,v.y*=l.y/2,h.x*=l.x/2,h.y*=l.y/2,m.start.copy(v),m.start.z=0,m.end.copy(h),m.end.z=0;const M=m.closestPointToPointParameter(oe,!0);m.at(M,Ae);const B=Je.lerp(v.z,h.z,M),I=B>=-1&&B<=1,H=oe.distanceTo(Ae)<T*.5;if(I&&H){m.start.fromBufferAttribute(u,s),m.end.fromBufferAttribute(g,s),m.start.applyMatrix4(f),m.end.applyMatrix4(f);const p=new U,S=new U;z.distanceSqToSegment(m.start,m.end,S,p),t.push({point:S,pointOnLine:p,distance:z.origin.distanceTo(S),object:n,face:null,faceIndex:s,uv:null,uv1:null})}}}class gt extends ke{constructor(e=new dt,t=new ut({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,i=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let f=0,o=0,u=t.count;f<u;f++,o+=2)Ee.fromBufferAttribute(t,f),ze.fromBufferAttribute(i,f),r[o]=o===0?0:r[o-1],r[o+1]=r[o]+Ee.distanceTo(ze);const l=new le(r,2,1);return e.setAttribute("instanceDistanceStart",new P(l,1,0)),e.setAttribute("instanceDistanceEnd",new P(l,1,1)),this}raycast(e,t){const i=this.material.worldUnits,r=e.camera;r===null&&!i&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const l=e.params.Line2!==void 0&&e.params.Line2.threshold||0;z=e.ray;const f=this.matrixWorld,o=this.geometry,u=this.material;T=u.linewidth+l,o.boundingSphere===null&&o.computeBoundingSphere(),J.copy(o.boundingSphere).applyMatrix4(f);let g;if(i)g=T*.5;else{const a=Math.max(r.near,J.distanceToPoint(z.origin));g=Ue(r,a,u.resolution)}if(J.radius+=g,z.intersectsSphere(J)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),X.copy(o.boundingBox).applyMatrix4(f);let d;if(i)d=T*.5;else{const a=Math.max(r.near,X.distanceToPoint(z.origin));d=Ue(r,a,u.resolution)}X.expandByScalar(d),z.intersectsBox(X)!==!1&&(i?pt(this,t):vt(this,r,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(ae),this.material.uniforms.resolution.value.set(ae.z,ae.w))}}export{dt as L,ut as a,gt as b,mt as g};
