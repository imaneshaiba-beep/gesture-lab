// shape_pixel.glsl — GLSL MAT (TouchDesigner), shader de pixels.
// Cœur sombre, bords irisés, reflet qui suit la main, glitch par blocs, grain.
// Uniforms à déclarer dans le GLSL MAT, page "Vectors" : uTime, uGlitch, uLight (vec2), uBlock.

uniform float uTime;
uniform float uGlitch;
uniform vec2 uLight;
uniform float uBlock;   // taille des blocs de glitch en pixels (≈ 22 en 1080p, 44 en 4K)

in vec3 vCamPos;
in vec3 vCamNormal;
in float vNoise;

layout(location = 0) out vec4 fragColor;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 pal(float t){ return .5 + .5 * cos(6.28318 * (t + vec3(0., .33, .67))); } // palette irisée (I. Quilez)

void main(){
  TDCheckDiscard();
  vec3 N = normalize(vCamNormal);
  vec3 V = normalize(-vCamPos);
  float fres = pow(1. - clamp(dot(N, V), 0., 1.), 1.5);
  vec3 L = normalize(vec3(uLight * 1.6, 1.3));
  float t = fres * .85 + vNoise * .35 + uTime * .035 + dot(N, L) * .22;

  vec2 blk = floor(gl_FragCoord.xy / max(uBlock, 1.));
  if (hash(blk + floor(uTime * 12.)) < uGlitch * .32) t += .5 * hash(blk * 1.7 + 3.);

  vec3 irid = pal(t);
  vec3 core = vec3(.018, .018, .03) + pal(t + .5) * .07;
  vec3 col = mix(core, irid, smoothstep(.04, .82, fres + vNoise * .16));
  col += pow(max(dot(reflect(-L, N), V), 0.), 46.) * .85;
  col += (hash(gl_FragCoord.xy + fract(uTime) * 91.7) - .5) * .15;

  fragColor = TDOutputSwizzle(vec4(col, 1.));
}
