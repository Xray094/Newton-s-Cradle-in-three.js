import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'

/**
 * ============================================================================
 * PHYSICS REFERENCE (matches "دراسة حركة بندول نيوتن" chapters 1 & 2)
 * ============================================================================
 * Single pendulum, real (damped) equation of motion (Ch.1 §2):
 * τ_net = -m g L sin(θ) - c L² ω - b ω
 * α = τ_net / (m L²) = -(g/L) sin(θ) - (c/m) ω - (b/(mL²)) ω
 * where:
 * c -> air resistance coefficient (linear drag on the ball, F_d = -c v)
 * b -> friction/damping at the suspension pivot (τ_f = -b ω)
 *
 * Integration (Ch.1 §3): Semi-implicit ("symplectic") Euler
 * ω(n+1) = ω(n) + α(n) Δt
 * θ(n+1) = θ(n) + ω(n+1) Δt      <-- uses the *updated* ω, this is what
 * makes semi-implicit Euler stable
 * for oscillatory systems.
 *
 * Energy (Ch.1 §4):
 * U = m g L (1 - cos θ)          potential energy
 * K = 1/2 m (Lω)²                kinetic energy (v = Lω)
 * E = U + K should only ever decrease (never increase) for a
 * physically valid damped/dissipative simulation -> used below as a
 * live sanity check, exactly as the report recommends.
 *
 * Contact / collision (Ch.2 §4): Hertzian non-linear contact theory
 * δ  = (R1+R2) - distance_between_centers      (interpenetration depth)
 * F_hertz = K_h * δ^1.5                        (Hertz's law, F ∝ δ^3/2)
 * K_h = (4/3) E_eff sqrt(R_eff)                 (generalized stiffness)
 * 1/E_eff = 2(1-ν²)/E   (identical spheres)     R_eff = R/2
 * NOTE: when balls have DIFFERENT masses (see below) they also get
 * different radii, so R_eff generalizes to (R1*R2)/(R1+R2) - see
 * computeHertzStiffness() further down, used instead of the single-radius
 * version for every contact pair. Two more realism refinements follow
 * from this: (1) air resistance c scales per-ball with radius, since the
 * report's drag law F_d=-cv is linear/Stokes-type (c ∝ r); (2) contact
 * damping scales with the pair's reduced mass m_eff = m1*m2/(m1+m2), the
 * standard approach in Hertz-contact DEM models, so a light ball hitting
 * a heavy one doesn't get an unrealistically oversized damping force.
 * Neither the Hertz force itself nor momentum conservation depend on
 * mass scaling tricks though - those already work exactly for any mass
 * ratio, because the contact force is equal-and-opposite (Newton's 3rd
 * law) and each ball's acceleration is that same force divided by its
 * OWN mass (Newton's 2nd law): Δp1 = -Δp2 automatically, always.
 *
 * Restitution coefficient e (Ch.2 §2-3): the report *defines* e as the
 * ratio of separation speed to approach speed at a contact - it is an
 * emergent property of the Hertz + viscoelastic-damping contact model,
 * not something you dial in directly. So instead of faking it with a
 * bounce multiplier, this sim *measures* e live from every collision and
 * reports it back in the GUI, which is exactly how the report defines it.
 *
 * Chapter 3 "دراسة تأثير الحالات المختلفة على النظام" (Study of the
 * different cases affecting the system) - reproduced below as one-click
 * presets in the "Study Cases" GUI folder:
 *   §1 رفع كرة واحدة وإفلاتها          -> Case ① Single Ball
 *   §2 رفع كرتين وإفلاتهما             -> Case ② Two Balls
 *   §3 تغيير عدد الكرات في النظام      -> Case ③ Mini 3-Ball System
 *   تأثير اختلاف الكتل بين الكرات      -> Case ④ Unequal Masses (+ the
 *        per-ball mass sliders below let you set ANY custom mass mix).
 *        Report: "if the striking ball is lighter it rebounds backward;
 *        if heavier it keeps moving forward but slower - unequal mass
 *        breaks synchrony and scatters the balls chaotically."
 *   §5 حالة النظام الواقعي (مع التخميد) -> Case ⑤ Realistic Damped System
 * ============================================================================
 */

const STEEL_E = 200e9      // Young's modulus of steel (Pa)
const STEEL_NU = 0.3       // Poisson's ratio of steel
const MAX_BALLS = 8

// IMPORTANT: the mass sliders in the GUI are bound directly to the
// `ballMasses` array object below (massFolder.add(parameters.ballMasses, i)).
// dat.gui keeps a reference to that exact array, so we must always mutate
// it IN PLACE (write into existing slots) rather than doing
// `parameters.ballMasses = [...]`, which would swap in a brand-new array
// that the sliders no longer point to - they'd keep editing the old
// (now-unused) array while the physics reads from the new one, silently
// going out of sync. Every preset below goes through this helper instead.
function setMasses(values) {
    for (let i = 0; i < MAX_BALLS; i++) {
        parameters.ballMasses[i] = values[i] !== undefined ? values[i] : 1.0
    }
}

const parameters = {
    gravity: 9.81,
    airResistanceC: 0.05,     // c : linear air drag coefficient
    pivotFrictionB: 0.02,     // b : suspension-point friction coefficient
    stiffnessSoftening: 2e-4, // real steel K_h is ~1e10-1e11 and needs a Δt
                              // far smaller than real-time can afford (the
                              // report itself notes the shockwave crosses a
                              // ball chain in microseconds). We keep the
                              // correct δ^1.5 Hertz *shape* but scale K_h
                              // down so a 2000Hz timestep stays stable -
                              // this preserves the qualitative physics
                              // (relative stiffness between configurations)
                              // while remaining real-time.
                              // NOTE: near the top of this slider's range
                              // you're intentionally approaching real
                              // (un-softened) steel stiffness again, which
                              // can outrun even the max Physics Precision
                              // (Hz) and go numerically unstable - that's
                              // an expected explicit-integration limit
                              // (see the delta clamp safety net in
                              // stepPhysics), not a modeling bug. Pair a
                              // higher stiffness with a higher Hz.
    contactDamping: 15.0,      // viscoelastic damping during compression
    physicsHz: 2000,           // required to resolve microsecond-scale Hertz
                               // contact events without tunnelling (Ch.2 §4)
    count: 5,
    launchBalls: 1,
    launchAngleDeg: 30,
    enableSound: true,
    launch: () => setupCradle(),

    // Pendulum (string) length. Kept in `parameters` instead of `config` so
    // it's GUI-controllable. GUI slider only allows lengthening it (min ==
    // the original 1.5m default) - see the "String Length" control below.
    // Lengthening it does NOT push the balls toward/into the floor: the
    // frame's height (config.topY) is recomputed from this value every
    // time setupCradle() runs, so the balls always rest at the same
    // height above the ground and only the support frame grows taller -
    // like swapping in a taller stand for a longer pendulum.
    stringLength: 1.5,

    // Per-ball masses (kg, relative), report Ch.2 "تأثير اختلاف الكتل بين
    // الكرات". Only the first `count` entries are actually simulated; the
    // rest just sit unused until you raise the ball count. Radius scales
    // with mass (constant-density spheres, mass ∝ r³) so heavier balls are
    // visibly bigger, and color shifts warmer for heavier / cooler for
    // lighter, so mass differences are readable at a glance.
    ballMasses: new Array(MAX_BALLS).fill(1.0),
    equalizeMasses: () => {
        setMasses(new Array(MAX_BALLS).fill(1.0))
        setupCradle()
        gui.updateDisplay()
    },

    // Live validation readouts (Ch.1 §4 energy check, Ch.2 §3 restitution)
    totalEnergy: 0,
    lastMeasuredE: 1.0,

    // ---- Study-case presets (Ch.3 "دراسة تأثير الحالات المختلفة") ----
    caseSingleBall: () => {
        parameters.count = 5
        parameters.launchBalls = 1
        parameters.launchAngleDeg = 30
        parameters.stringLength = 1.5
        setMasses(new Array(MAX_BALLS).fill(1.0))
        parameters.airResistanceC = 0.01
        parameters.pivotFrictionB = 0.005
        setupCradle()
        gui.updateDisplay()
    },
    caseTwoBalls: () => {
        parameters.count = 5
        parameters.launchBalls = 2
        parameters.launchAngleDeg = 30
        parameters.stringLength = 1.5
        setMasses(new Array(MAX_BALLS).fill(1.0))
        parameters.airResistanceC = 0.01
        parameters.pivotFrictionB = 0.005
        setupCradle()
        gui.updateDisplay()
    },
    caseMiniSystem: () => {
        parameters.count = 3
        parameters.launchBalls = 1
        parameters.launchAngleDeg = 30
        parameters.stringLength = 1.5
        setMasses(new Array(MAX_BALLS).fill(1.0))
        parameters.airResistanceC = 0.01
        parameters.pivotFrictionB = 0.005
        setupCradle()
        gui.updateDisplay()
    },
    caseUnequalMasses: () => {
        parameters.count = 5
        parameters.launchBalls = 1
        parameters.launchAngleDeg = 30
        parameters.stringLength = 1.5
        // Deliberately unequal masses: report predicts the striking ball
        // rebounds/continues unevenly and the chain loses perfect sync.
        setMasses([1.0, 0.5, 1.0, 2.2, 1.0, 1.0, 1.0, 1.0])
        parameters.airResistanceC = 0.01
        parameters.pivotFrictionB = 0.005
        setupCradle()
        gui.updateDisplay()
    },
    caseRealisticDamping: () => {
        parameters.count = 5
        parameters.launchBalls = 1
        parameters.launchAngleDeg = 30
        parameters.stringLength = 1.5
        setMasses(new Array(MAX_BALLS).fill(1.0))
        parameters.airResistanceC = 0.15
        parameters.pivotFrictionB = 0.08
        setupCradle()
        gui.updateDisplay()
    }
}

// Derived (physically real) Hertz stiffness, generalized to two spheres of
// DIFFERENT radii (needed now that mass, and therefore radius, can vary
// per ball): K_h = (4/3) * E_eff * sqrt(R_eff), R_eff = (R1*R2)/(R1+R2)
function computeHertzStiffness(r1, r2) {
    const Eeff = STEEL_E / (2 * (1 - STEEL_NU * STEEL_NU))
    const Reff = (r1 * r2) / (r1 + r2)
    return (4 / 3) * Eeff * Math.sqrt(Reff)
}

// mass -> radius assuming constant density (mass ∝ volume ∝ r³), anchored
// so mass = 1.0 gives back the original config.ballRadius
function radiusForMass(mass) {
    return config.ballRadius * Math.cbrt(Math.max(mass, 0.05))
}

// Per-ball air-resistance coefficient. The report's drag law is LINEAR in
// velocity (F_d = -c v), which is the Stokes-drag regime, where the
// coefficient itself scales linearly with the object's radius (c ∝ r) -
// NOT with r² (that would be the quadratic/high-Reynolds drag regime,
// which is a different force law entirely). Since balls of different mass
// now have different radii, each ball needs its own effective c so a
// bigger/heavier ball feels proportionally more absolute drag, exactly as
// real Stokes drag would predict. At mass = 1.0 (radius = config.ballRadius)
// this returns exactly `airResistanceC`, so the baseline behavior is
// unchanged from before mass variation was added.
function dragCoefficientForRadius(radius) {
    return parameters.airResistanceC * (radius / config.ballRadius)
}

// Visual mass coding: light balls skew cool/cyan, heavy balls skew
// warm/gold, baseline (mass = 1) stays the original neutral chrome.
const COLOR_LIGHT = new THREE.Color(0x9fd8ef)
const COLOR_NEUTRAL = new THREE.Color(0xdddddd)
const COLOR_HEAVY = new THREE.Color(0xd8a83f)
function colorForMass(mass) {
    if (mass <= 1.0) {
        const t = THREE.MathUtils.clamp((mass - 0.2) / 0.8, 0, 1)
        return COLOR_LIGHT.clone().lerp(COLOR_NEUTRAL, t)
    } else {
        const t = THREE.MathUtils.clamp((mass - 1.0) / 4.0, 0, 1)
        return COLOR_NEUTRAL.clone().lerp(COLOR_HEAVY, t)
    }
}

// Canvas & Scene setup
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf1f3f5) // Cleaner, premium modern background

/**
 * Window Resize
 */
const sizes = { width: window.innerWidth, height: window.innerHeight }
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
})

/**
 * Camera & Controls
 */
const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 100)
camera.position.set(2.5, 2.5, 4.0) // Dynamic view angle for the 3D frame
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.02 // Prevent camera from traveling under the floor
controls.target.set(0, 0.95, 0)

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

/**
 * Lights
 */
const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
scene.add(ambientLight)

// Studio lighting setup for sharp reflection highlights and soft shadows
const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
keyLight.position.set(4, 7, 3)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.bias = -0.0001
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.4) // Subtle blue fill from opposing side
fillLight.position.set(-4, 3, -3)
scene.add(fillLight)

/**
 * Ground
 */
const groundGroup = new THREE.Group()
scene.add(groundGroup)

const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.1 })
)
ground.rotation.x = - Math.PI * 0.5
ground.position.y = -0.02
ground.receiveShadow = true
groundGroup.add(ground)

// Studio floor grid line accents
const gridHelper = new THREE.GridHelper(20, 20, 0xcbced4, 0xe2e8f0)
gridHelper.position.y = -0.01
groundGroup.add(gridHelper)

/**
 * Web Audio API - Procedural Metallic Clack Generator
 */
let audioCtx = null

function playClackSound(intensity) {
    if (!parameters.enableSound || intensity < 0.05) return

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume()
    }

    const now = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(2200, now)
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.015)

    const maxVolume = Math.min(0.3, intensity * 0.15)
    gainNode.gain.setValueAtTime(maxVolume, now)
    gainNode.gain.exponentialRampToValueAtTime(0.00001, now + 0.025)

    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)

    osc.start(now)
    osc.stop(now + 0.03)
}

/**
 * Newton's Cradle Architectural Configurations
 */
const config = {
    ballRadius: 0.22, // Realistic layout proportions (radius for a mass = 1.0 ball)
    topY: 2.2,
    frameDepth: 1.0  // Depth thickness mapping for the outer crossbeams
}

// How high above the ground the balls rest at their original defaults
// (topY 2.2 - stringLength 1.5 = 0.7). setupCradle() recomputes config.topY
// from this constant plus the current pendulum length every time it runs,
// so lengthening the rope always grows the frame taller instead of
// dropping the balls toward the floor.
const REST_HEIGHT_ABOVE_GROUND = 0.7

// Global structural groups and data tracking
let cradleGroup = new THREE.Group()
scene.add(cradleGroup)
let bobs = []
let contactEpisodes = [] // per-pair tracking used to measure e = v_sep/v_approach

// Industrial structural matte frame
const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.7, roughness: 0.2 })
const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x555555 })

/**
 * Setup / Rebuild Cradle Architecture dynamically based on user controls
 */
function setupCradle() {
    while (cradleGroup.children.length > 0) {
        const obj = cradleGroup.children[0]
        cradleGroup.remove(obj)
    }
    bobs = []

    // Frame height follows the current pendulum length so the balls always
    // rest at the same height above the ground (see REST_HEIGHT_ABOVE_GROUND
    // above) - lengthening the "String Length" slider grows the support
    // frame taller instead of pushing the balls into the floor.
    config.topY = REST_HEIGHT_ABOVE_GROUND + parameters.stringLength

    // Per-ball radius, derived from each ball's own mass (report Ch.2:
    // "اختلاف الكتل بين الكرات"). All balls still touch their neighbours,
    // just with a per-pair gap instead of one fixed spacing constant.
    const radii = []
    for (let i = 0; i < parameters.count; i++) {
        radii.push(radiusForMass(parameters.ballMasses[i]))
    }

    const microGap = 0.001 // micro-gap between balls, referenced in Ch.2 §4
                            // as the reason the shockwave takes a (very
                            // small) finite time to cross the chain
    const anchorXRaw = [0]
    for (let i = 1; i < parameters.count; i++) {
        anchorXRaw.push(anchorXRaw[i - 1] + radii[i - 1] + radii[i] + microGap)
    }
    const leftEdge = anchorXRaw[0] - radii[0]
    const rightEdge = anchorXRaw[anchorXRaw.length - 1] + radii[radii.length - 1]
    const centerShift = (leftEdge + rightEdge) / 2
    const anchorXs = anchorXRaw.map(x => x - centerShift)

    const structureLength = Math.max((rightEdge - leftEdge) + 1.0, 2.0)
    const halfDepth = config.frameDepth * 0.5

    // --- ENHANCED STRUCTURAL FRAME (Connected canopy structure) ---

    // Central cross rail to which the single-line ropes are anchored down the middle
    const centerRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, structureLength, 24), poleMaterial)
    centerRail.rotation.z = Math.PI * 0.5
    centerRail.position.set(0, config.topY, 0)
    centerRail.castShadow = true
    cradleGroup.add(centerRail)

    // Two outer parallel support rods along the depth limits to form the solid rectangular canopy
    for (let zDir of [-1, 1]) {
        const sideBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, structureLength, 24), poleMaterial)
        sideBar.rotation.z = Math.PI * 0.5
        sideBar.position.set(0, config.topY, zDir * halfDepth)
        sideBar.castShadow = true
        cradleGroup.add(sideBar)
    }

    // Transverse connecting rods interlocking the side rails to the frame ends like a structural chassis
    const crossBarGeom = new THREE.CylinderGeometry(0.025, 0.025, config.frameDepth, 24)
    const crossBarOffset = structureLength * 0.5
    for (let xDir of [-1, 1]) {
        const crossBar = new THREE.Mesh(crossBarGeom, poleMaterial)
        crossBar.rotation.x = Math.PI * 0.5
        crossBar.position.set(xDir * crossBarOffset, config.topY, 0)
        crossBar.castShadow = true
        cradleGroup.add(crossBar)
    }

    // 4 Corner support pillars linking down from the intersections to ground the apparatus safely
    const legGeom = new THREE.CylinderGeometry(0.035, 0.035, config.topY, 20)
    for (let side of [-1, 1]) {
        for (let zDir of [-1, 1]) {
            const leg = new THREE.Mesh(legGeom, poleMaterial)
            leg.position.set(side * crossBarOffset, config.topY * 0.5, zDir * halfDepth)
            leg.castShadow = true
            cradleGroup.add(leg)
        }
    }

    for (let i = 0; i < parameters.count; i++) {
        const anchorX = anchorXs[i]
        const mass = parameters.ballMasses[i]
        const radius = radii[i]

        // Each ball now gets its own geometry/material sized & colored by
        // its own mass, instead of one shared sphere for every ball.
        const sphereGeometry = new THREE.SphereGeometry(radius, 48, 48)
        const sphereMaterial = new THREE.MeshStandardMaterial({
            color: colorForMass(mass), metalness: 1.0, roughness: 0.02
        })
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
        sphere.castShadow = true
        sphere.receiveShadow = true
        cradleGroup.add(sphere)

        // Single rope suspension model anchored directly beneath the center structural beam
        const ropePoints = [new THREE.Vector3(anchorX, config.topY, 0), new THREE.Vector3()]
        const ropeGeometry = new THREE.BufferGeometry().setFromPoints(ropePoints)
        const rope = new THREE.Line(ropeGeometry, ropeMaterial)
        cradleGroup.add(rope)

        const bob = {
            anchorX: anchorX,
            theta: 0,
            omega: 0,
            radius: radius,
            mass: mass,
            x: anchorX,
            y: config.topY - parameters.stringLength,
            vx: 0,
            vy: 0,
            mesh: sphere,
            ropeGeometry: ropeGeometry,
            ropePoints: ropePoints,
            inContactLastFrame: false
        }

        // Initial condition (Ch.1 "الحالة الابتدائية"): lifted balls start
        // from rest, ω0 = 0, at angle θ0.
        if (i < parameters.launchBalls) {
            bob.theta = - THREE.MathUtils.degToRad(parameters.launchAngleDeg)
            const sin = Math.sin(bob.theta)
            const cos = Math.cos(bob.theta)
            bob.x = bob.anchorX + parameters.stringLength * sin
            bob.y = config.topY - parameters.stringLength * cos
            bob.vx = 0
            bob.vy = 0
        }

        bobs.push(bob)
    }

    // one contact-episode tracker per neighbor pair, used to measure the
    // effective restitution coefficient e = v_separation / v_approach
    contactEpisodes = []
    for (let i = 0; i < bobs.length - 1; i++) {
        contactEpisodes.push({ active: false, approachSpeed: 0 })
    }
}

/**
 * Complete Physics Engine - Continuous pendulum ODE + discrete Hertz contact
 */
function stepPhysics(dt) {
    const L = parameters.stringLength
    const g = parameters.gravity

    // --- PHASE 1: Continuous domain - damped pendulum ODE (Ch.1 §2) ---
    for (let i = 0; i < bobs.length; i++) {
        const bob = bobs[i]

        // α = -(g/L) sinθ - (c/m) ω - (b/(mL²)) ω
        // c here is this ball's own radius-scaled drag coefficient (see
        // dragCoefficientForRadius) so bigger/heavier balls correctly feel
        // more absolute air resistance, consistent with Stokes' linear
        // drag law (F_d = -cv, c ∝ r). Pivot friction b is left as one
        // constant shared by all balls, since it's a property of the
        // suspension/bearing structure itself (report: "ثابت يصف شدة
        // الاحتكاك في نقطة التعليق"), not of the individual ball.
        const c_i = dragCoefficientForRadius(bob.radius)
        const angularAcceleration =
            - (g / L) * Math.sin(bob.theta)
            - (c_i / bob.mass) * bob.omega
            - (parameters.pivotFrictionB / (bob.mass * L * L)) * bob.omega

        // Semi-implicit Euler (Ch.1 §3)
        bob.omega += angularAcceleration * dt
        bob.theta += bob.omega * dt

        const sin = Math.sin(bob.theta)
        const cos = Math.cos(bob.theta)
        bob.x = bob.anchorX + L * sin
        bob.y = config.topY - L * cos

        bob.vx = L * bob.omega * cos
        bob.vy = L * bob.omega * sin
    }

    // --- PHASE 2: Discrete domain - Hertzian contact (Ch.2 §4) ---
    for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < bobs.length - 1; i++) {
            const b1 = bobs[i]
            const b2 = bobs[i + 1]
            const episode = contactEpisodes[i]

            const dx = b2.x - b1.x
            const dy = b2.y - b1.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            const minDistance = b1.radius + b2.radius

            if (distance < minDistance) {
                const deltaRaw = minDistance - distance // interpenetration δ

                // Numerical stability safety net: explicit integration of a
                // Hertz spring is only stable if Δt is small relative to
                // the contact's natural frequency (~sqrt(K_h/m_eff)), which
                // grows with the Stiffness Scale slider. If a frame ever
                // lets the balls overlap more than this, it means Δt was
                // too coarse for the current stiffness and the raw δ^1.5
                // force would explode into feedback runaway next step. We
                // clamp only the FORCE calculation here (not the rendered
                // position, which keeps evolving from θ, ω as normal) -
                // this trades a little accuracy in that rare overshoot
                // frame for keeping the whole system numerically bounded,
                // instead of the balls flying off to infinity/NaN.
                const maxDelta = 0.35 * Math.min(b1.radius, b2.radius)
                const delta = Math.min(deltaRaw, maxDelta)

                if (delta > 0) {
                    // Hertz normal force: F = K_h δ^1.5 (K_h now computed
                    // per-pair from each ball's own radius, see above)
                    const kh = computeHertzStiffness(b1.radius, b2.radius) * parameters.stiffnessSoftening
                    const hertzForceMagnitude = kh * Math.pow(delta, 1.5)

                    const nx = dx / (distance || 1)
                    const ny = dy / (distance || 1)

                    const rvx = b2.vx - b1.vx
                    const rvy = b2.vy - b1.vy
                    const vNormal = rvx * nx + rvy * ny // negative = approaching

                    if (pass === 0) {
                        if (!episode.active && vNormal < -0.01) {
                            // contact just started: record approach speed
                            episode.active = true
                            episode.approachSpeed = Math.abs(vNormal)
                            playClackSound(episode.approachSpeed)
                        }
                    }

                    // Viscoelastic (Kelvin-Voigt style) contact damping.
                    // Scaled by the reduced/effective mass m_eff =
                    // m1*m2/(m1+m2), as is standard in Hertz-contact DEM
                    // models (e.g. Hertz-Mindlin/Tsuji) - without this, a
                    // very light ball hitting a very heavy one would feel
                    // an unrealistically large damping force relative to
                    // its own inertia. The (2 * m_eff) factor is chosen so
                    // that for two equal 1kg balls (m_eff = 0.5) this
                    // reduces to exactly the old constant-damping formula,
                    // keeping default behavior unchanged.
                    const meff = (b1.mass * b2.mass) / (b1.mass + b2.mass)
                    const dampingForce = - parameters.contactDamping * (2 * meff) * vNormal * Math.sqrt(delta)
                    const totalForce = Math.max(0, hertzForceMagnitude + dampingForce)

                    // a = F/m for each ball along the contact normal - this
                    // is exactly what makes unequal-mass collisions behave
                    // like the report describes (Ch.2 "تأثير اختلاف الكتل"):
                    // a lighter struck ball accelerates more (rebounds
                    // harder / flies off faster), a heavier one barely
                    // budges, because a = F/m differs per ball.
                    const a1 = totalForce / b1.mass
                    const a2 = totalForce / b2.mass

                    b1.vx -= a1 * nx * dt
                    b1.vy -= a1 * ny * dt
                    b2.vx += a2 * nx * dt
                    b2.vy += a2 * ny * dt

                    // Reproject linear velocity back onto the pendulum's
                    // tangential (constraint) direction: for v = Lω(cosθ,sinθ),
                    // the tangential component recovers ω = (vx cosθ + vy sinθ)/L
                    const cos1 = Math.cos(b1.theta)
                    b1.omega = (b1.vx * cos1 + b1.vy * Math.sin(b1.theta)) / L

                    const cos2 = Math.cos(b2.theta)
                    b2.omega = (b2.vx * cos2 + b2.vy * Math.sin(b2.theta)) / L

                    b1.inContactLastFrame = true
                }
            } else {
                if (pass === 0) {
                    b1.inContactLastFrame = false
                    if (episode.active) {
                        // Contact just ended: measure separation speed and
                        // derive the effective restitution coefficient
                        // e = v_separation / v_approach, exactly as defined
                        // in Ch.2 §2-3 of the report.
                        const dx2 = b2.x - b1.x
                        const dy2 = b2.y - b1.y
                        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
                        const nx2 = dx2 / dist2
                        const ny2 = dy2 / dist2
                        const rvx2 = b2.vx - b1.vx
                        const rvy2 = b2.vy - b1.vy
                        const vSep = rvx2 * nx2 + rvy2 * ny2 // positive = separating

                        if (episode.approachSpeed > 0.01 && vSep > 0) {
                            parameters.lastMeasuredE = vSep / episode.approachSpeed
                        }
                        episode.active = false
                    }
                }
            }
        }
    }
}

/**
 * Live total mechanical energy, U + K per ball (Ch.1 §4 validation check)
 */
function computeTotalEnergy() {
    const L = parameters.stringLength
    const g = parameters.gravity
    let total = 0
    for (const bob of bobs) {
        const U = bob.mass * g * L * (1 - Math.cos(bob.theta))
        const v = L * bob.omega
        const K = 0.5 * bob.mass * v * v
        total += U + K
    }
    return total
}

/**
 * Mirror computed abstract positions onto Renderable WebGL Meshes
 */
function updateVisuals() {
    for (let i = 0; i < bobs.length; i++) {
        const bob = bobs[i]
        bob.mesh.position.set(bob.x, bob.y, 0)

        bob.ropePoints[1].set(bob.x, bob.y, 0)
        bob.ropeGeometry.setFromPoints(bob.ropePoints)
    }
}

// Initial Generation
setupCradle()

/**
 * Dynamic Graphical User Interface Sliders
 */
const gui = new dat.GUI({ width: 380 })

// One-click reproductions of every case walked through in report Ch.3
// "دراسة تأثير الحالات المختلفة على النظام"
const caseFolder = gui.addFolder('📖 Study Cases (دراسة الحالات)')
caseFolder.add(parameters, 'caseSingleBall').name('① Single Ball')
caseFolder.add(parameters, 'caseTwoBalls').name('② Two Balls')
caseFolder.add(parameters, 'caseMiniSystem').name('③ Mini 3-Ball System')
caseFolder.add(parameters, 'caseUnequalMasses').name('④ Unequal Masses (Chaos)')
caseFolder.add(parameters, 'caseRealisticDamping').name('⑤ Realistic Damped System')
caseFolder.open()

const envFolder = gui.addFolder('Environment Configuration')
envFolder.add(parameters, 'gravity').min(0).max(25).step(0.1).name('Gravity g (m/s²)')
envFolder.add(parameters, 'airResistanceC').min(0).max(0.5).step(0.005).name('Air Resistance c')
envFolder.add(parameters, 'pivotFrictionB').min(0).max(0.2).step(0.005).name('Pivot Friction b')
envFolder.add(parameters, 'enableSound').name('Enable Clack Sound')
envFolder.open()

const hertzFolder = gui.addFolder('Hertzian Contact Mechanics')
hertzFolder.add(parameters, 'stiffnessSoftening').min(1e-5).max(1e-3).step(1e-5).name('Stiffness Scale')
hertzFolder.add(parameters, 'contactDamping').min(0).max(50).step(0.1).name('Impact Absorption')
hertzFolder.add(parameters, 'physicsHz').min(1000).max(4000).step(100).name('Physics Precision (Hz)')
hertzFolder.open()

const setupFolder = gui.addFolder('Cradle Assembly Setup')
setupFolder.add(parameters, 'count').min(2).max(MAX_BALLS).step(1).name('Total Balls Count').onChange(() => setupCradle())
setupFolder.add(parameters, 'launchBalls').min(1).max(MAX_BALLS - 1).step(1).name('Balls to Drop').onChange((val) => {
    if (val >= parameters.count) parameters.launchBalls = parameters.count - 1
})
setupFolder.add(parameters, 'launchAngleDeg').min(5).max(75).step(1).name('Drop Angle (°)').onChange(() => setupCradle())
setupFolder.add(parameters, 'stringLength').min(1.5).max(3.0).step(0.05).name('String Length (m)').onChange(() => setupCradle())
setupFolder.add(parameters, 'launch').name('Drop / Reset Cradle')
setupFolder.open()

// Per-ball mass sliders (report Ch.2 "اختلاف الكتل بين الكرات"). Only the
// first `Total Balls Count` sliders are physically active - raise the
// ball count above to bring more of them into play.
const massFolder = gui.addFolder('⚖️ Ball Masses (only first N used)')
for (let i = 0; i < MAX_BALLS; i++) {
    massFolder.add(parameters.ballMasses, i).min(0.2).max(5.0).step(0.1).name(`Ball ${i + 1} Mass (kg)`).onChange(() => setupCradle())
}
massFolder.add(parameters, 'equalizeMasses').name('Reset All to 1 kg')

// Live validation readouts, matching the report's suggestion to compute
// energy every timestep and watch for unphysical growth.
const validationFolder = gui.addFolder('Live Validation (report Ch.1 §4 / Ch.2 §3)')
validationFolder.add(parameters, 'totalEnergy').name('Total Energy U+K (J)').listen()
validationFolder.add(parameters, 'lastMeasuredE').name('Measured e (last hit)').listen()
validationFolder.open()

/**
 * Runtime Loop Engine Thread
 */
const clock = new THREE.Clock()
let accumulator = 0

const tick = () => {
    const delta = Math.min(clock.getDelta(), 0.033)
    accumulator += delta

    const physicsStep = 1 / parameters.physicsHz

    while (accumulator >= physicsStep) {
        stepPhysics(physicsStep)
        accumulator -= physicsStep
    }

    parameters.totalEnergy = computeTotalEnergy()

    updateVisuals()
    controls.update()
    renderer.render(scene, camera)

    window.requestAnimationFrame(tick)
}

tick()