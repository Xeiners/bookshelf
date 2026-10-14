import * as THREE from 'three'

/*
 * L'Éveil, gagné au quiz : le coureur s'embrase. Une aura de flammes dorées monte autour de
 * lui (deux couches de feu animées dans un shader), des éclairs crépitent, des étincelles
 * s'envolent, un cercle de lumière brûle au sol. À l'activation, une colonne de lumière et
 * une onde de choc balaient la voie. Tout est additif et sans ombre : quelques appels de
 * dessin, aucune texture à charger.
 */

// i18n-ignore (shaders)
const FLAME_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vec3 normal = normalize(normalMatrix * normal);
  vFacing = abs(dot(normal, normalize(-view.xyz)));
  gl_Position = projectionMatrix * view;
}
`

// i18n-ignore (shaders)
const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uPower;
uniform vec3 uCore;
uniform vec3 uEdge;
uniform float uSeed;
varying vec2 vUv;
varying float vFacing;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // Langues de feu : du bruit qui défile vers le haut, plus déchiré en hauteur.
  vec2 p = vec2(vUv.x * 9.0 + uSeed, vUv.y * 2.4 - uTime * 2.6);
  float n = noise(p) * 0.6 + noise(p * 2.3 + 4.0) * 0.3 + noise(p * 5.0 - 2.0) * 0.1;
  float height = vUv.y;
  float flame = smoothstep(0.0, 0.08, height) * (1.0 - smoothstep(0.25 + n * 0.7, 0.95, height));
  flame *= 0.45 + n;
  // Plus vif sur les bords (vu de profil) qu'en face : une gaine de lumière, pas un mur.
  float rim = mix(1.0, 0.35, vFacing);
  float alpha = clamp(flame * rim * uPower, 0.0, 1.0);
  vec3 color = mix(uEdge, uCore, smoothstep(0.35, 1.0, n + (1.0 - height) * 0.4));
  gl_FragColor = vec4(color * alpha * 1.6, alpha);
}
`

/** Une gaine ouverte, renflée à mi-hauteur et pointue en haut (silhouette d'une flamme). */
function flameGeometry(radius: number, height: number): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = []
  for (let index = 0; index <= 12; index += 1) {
    const v = index / 12
    profile.push(new THREE.Vector2(radius * (0.7 + Math.sin(v * Math.PI * 0.9) * 0.55) * (1 - v * v * 0.75), v * height))
  }
  return new THREE.LatheGeometry(profile, 28)
}

function flameMaterial(core: string, edge: string, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: FLAME_VERTEX,
    fragmentShader: FLAME_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPower: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uSeed: { value: seed },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** Un disque lumineux (dégradé radial) : sol, éclair au départ. */
function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,236,150,0.9)')
  gradient.addColorStop(0.6, 'rgba(255,170,40,0.35)')
  gradient.addColorStop(1, 'rgba(255,140,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

const SPARKS = 48
const BOLTS = 3
const BOLT_POINTS = 9

export class AwakeningAura {
  readonly object = new THREE.Group()
  private readonly flames: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  private readonly pillar: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>
  private readonly sparks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  private readonly sparkLife = new Float32Array(SPARKS)
  private readonly bolts: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
  private grow = 0
  private burst = 1
  private lastLeft = 0
  private boltClock = 0

  constructor() {
    this.flames = [flameMaterial('#fffbe0', '#ffb21a', 0), flameMaterial('#fff2a8', '#ff7a00', 3.7)].map((material, index) => {
      const mesh = new THREE.Mesh(flameGeometry(index === 0 ? 0.5 : 0.68, index === 0 ? 2.25 : 2.7), material)
      mesh.renderOrder = 3
      return mesh
    })
    this.object.add(...this.flames)

    const glow = glowTexture()
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = 0.03
    this.wave = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#ffe9a0', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    )
    this.wave.rotation.x = -Math.PI / 2
    this.wave.position.y = 0.06
    this.pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 30, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }),
    )
    this.pillar.position.y = 15

    const sparkGeometry = new THREE.BufferGeometry()
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3))
    this.sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({ map: glow, color: '#ffe48a', size: 0.16, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    this.sparks.frustumCulled = false
    for (let index = 0; index < SPARKS; index += 1) this.sparkLife[index] = Math.random()

    const boltGeometry = new THREE.BufferGeometry()
    boltGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLTS * (BOLT_POINTS - 1) * 2 * 3), 3))
    this.bolts = new THREE.LineSegments(boltGeometry, new THREE.LineBasicMaterial({ color: '#d9f4ff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    this.bolts.frustumCulled = false

    this.object.add(this.ground, this.wave, this.pillar, this.sparks, this.bolts)
    this.object.visible = false
  }

  /** `left` : secondes d'Éveil restantes (0 : aucun). */
  update(left: number, time: number, delta: number): void {
    const active = left > 0
    // Une nouvelle activation (le temps restant remonte) : colonne de lumière et onde de choc.
    if (left > this.lastLeft + 0.5) this.burst = 0
    this.lastLeft = left
    this.burst = Math.min(1, this.burst + delta / 0.9)
    this.grow = Math.max(0, Math.min(1, this.grow + (active ? delta * 5 : -delta * 3)))
    this.object.visible = this.grow > 0.001 || this.burst < 1
    if (!this.object.visible) return

    // Pulsation, et clignotement quand l'Éveil s'achève.
    const ending = active && left < 1.5 ? 0.35 + 0.65 * (Math.sin(time * 16) > 0 ? 1 : 0) : 1
    const power = this.grow * ending
    this.flames.forEach((flame, index) => {
      flame.material.uniforms.uTime!.value = time * (index === 0 ? 1 : 0.8)
      flame.material.uniforms.uPower!.value = power * (index === 0 ? 0.9 : 0.6)
      const breathe = 1 + Math.sin(time * 11 + index * 2) * 0.04
      flame.scale.set(breathe * (0.6 + this.grow * 0.4), 0.4 + this.grow * 0.6 + Math.sin(time * 7 + index) * 0.05, breathe * (0.6 + this.grow * 0.4))
      flame.rotation.y = time * (index === 0 ? 1.4 : -1.1)
    })
    this.ground.material.opacity = 0.75 * power * (0.85 + Math.sin(time * 9) * 0.15)
    this.ground.scale.setScalar(0.9 + Math.sin(time * 6) * 0.06)

    // Activation : la colonne s'éteint, l'onde file vers l'extérieur.
    const burst = this.burst
    this.pillar.visible = burst < 1
    this.pillar.material.opacity = (1 - burst) ** 2 * 0.7
    this.pillar.scale.set(0.4 + burst * 1.6, 1, 0.4 + burst * 1.6)
    this.wave.visible = burst < 1
    this.wave.material.opacity = (1 - burst) * 0.9
    this.wave.scale.setScalar(0.5 + (1 - (1 - burst) ** 3) * 9)

    // Étincelles : elles montent en spirale, puis renaissent au pied.
    const positions = this.sparks.geometry.attributes.position as THREE.BufferAttribute
    for (let index = 0; index < SPARKS; index += 1) {
      let life = this.sparkLife[index]! + delta * (0.9 + (index % 5) * 0.12)
      if (life > 1) life -= 1
      this.sparkLife[index] = life
      const angle = index * 2.39996 + life * 3 + time * 0.5
      const radius = 0.35 + (index % 7) * 0.06 + life * 0.25
      positions.setXYZ(index, Math.cos(angle) * radius, 0.1 + life * 2.6, Math.sin(angle) * radius)
    }
    positions.needsUpdate = true
    this.sparks.material.opacity = power
    this.sparks.material.size = 0.1 + this.grow * 0.08

    // Éclairs : redessinés quelques fois par seconde, des zigzags qui grimpent le long du corps.
    this.boltClock -= delta
    if (this.boltClock <= 0) {
      this.boltClock = 0.06 + Math.random() * 0.1
      const points = this.bolts.geometry.attributes.position as THREE.BufferAttribute
      let cursor = 0
      for (let bolt = 0; bolt < BOLTS; bolt += 1) {
        const base = Math.random() * Math.PI * 2
        let previous = new THREE.Vector3(Math.cos(base) * 0.45, 0.2 + Math.random() * 0.6, Math.sin(base) * 0.45)
        for (let point = 1; point < BOLT_POINTS; point += 1) {
          const angle = base + (Math.random() - 0.5) * 0.9
          const next = new THREE.Vector3(Math.cos(angle) * (0.35 + Math.random() * 0.3), previous.y + 0.12 + Math.random() * 0.12, Math.sin(angle) * (0.35 + Math.random() * 0.3))
          points.setXYZ(cursor++, previous.x, previous.y, previous.z)
          points.setXYZ(cursor++, next.x, next.y, next.z)
          previous = next
        }
      }
      points.needsUpdate = true
      this.bolts.material.opacity = power * (Math.random() < 0.35 ? 0 : 0.9)
    }
  }

  dispose(): void {
    this.object.traverse((node) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.Points || node instanceof THREE.LineSegments) {
        node.geometry.dispose()
        const material = node.material as THREE.Material & { map?: THREE.Texture | null }
        material.map?.dispose()
        material.dispose()
      }
    })
  }
}
