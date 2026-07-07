import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'

const STEEL_E = 200e9
const STEEL_NU = 0.3
const MAX_BALLS = 8

function setMasses(values) {
    for (let i = 0; i < MAX_BALLS; i++) {
        parameters.ballMasses[i] = values[i] !== undefined ? values[i] : 1.0
    }
}

const parameters = {
    gravity: 9.81,
    airResistanceC: 0.05,
    pivotFrictionB: 0.02,
    stiffnessSoftening: 2e-4,
    contactDamping: 15.0,
    physicsHz: 2000,
    count: 5,
    launchBalls: 1,
    launchAngleDeg: 30,
    enableSound: true,
    launch: () => setupCradle(),
    stringLength: 1.5,
    ballMasses: new Array(MAX_BALLS).fill(1.0),
    equalizeMasses: () => {
        setMasses(new Array(MAX_BALLS).fill(1.0))
        setupCradle()
        gui.updateDisplay()
    },
    totalEnergy: 0,
    potentialEnergy: 0,
    kineticEnergy: 0,
    lastMeasuredE: 0.995,

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

function computeHertzStiffness(r1, r2) {
    const Eeff = STEEL_E / (2 * (1 - STEEL_NU * STEEL_NU))
    const Reff = (r1 * r2) / (r1 + r2)
    return (4 / 3) * Eeff * Math.sqrt(Reff)
}

function radiusForMass(mass) {
    return config.ballRadius * Math.cbrt(Math.max(mass, 0.05))
}

function dragCoefficientForRadius(radius) {
    return parameters.airResistanceC * (radius / config.ballRadius)
}

const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xf1f3f5)

const sizes = { width: window.innerWidth, height: window.innerHeight }
window.addEventListener('resize', () => {
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()
    renderer.setSize(sizes.width, sizes.height)
})

const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 100)
camera.position.set(2.5, 2.5, 4.0)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.02
controls.target.set(0, 0.95, 0)

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7)
scene.add(ambientLight)

const keyLight = new THREE.DirectionalLight(0xffffff, 0.9)
keyLight.position.set(4, 7, 3)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.bias = -0.0001
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.4)
fillLight.position.set(-4, 3, -3)
scene.add(fillLight)

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

const gridHelper = new THREE.GridHelper(20, 20, 0xcbced4, 0xe2e8f0)
gridHelper.position.y = -0.01
groundGroup.add(gridHelper)

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

const config = {
    ballRadius: 0.22,
    topY: 2.2,
    frameDepth: 1.0
}

const REST_HEIGHT_ABOVE_GROUND = 0.7

let cradleGroup = new THREE.Group()
scene.add(cradleGroup)
let bobs = []
let contactEpisodes = []

const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x22262b, metalness: 0.7, roughness: 0.2 })
const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x555555 })

function setupCradle() {
    while (cradleGroup.children.length > 0) {
        const obj = cradleGroup.children[0]
        cradleGroup.remove(obj)
    }
    bobs = []

    config.topY = REST_HEIGHT_ABOVE_GROUND + parameters.stringLength

    const radii = []
    for (let i = 0; i < parameters.count; i++) {
        radii.push(radiusForMass(parameters.ballMasses[i]))
    }

    const microGap = 0.001
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

    const centerRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, structureLength, 24), poleMaterial)
    centerRail.rotation.z = Math.PI * 0.5
    centerRail.position.set(0, config.topY, 0)
    centerRail.castShadow = true
    cradleGroup.add(centerRail)

    for (let zDir of [-1, 1]) {
        const sideBar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, structureLength, 24), poleMaterial)
        sideBar.rotation.z = Math.PI * 0.5
        sideBar.position.set(0, config.topY, zDir * halfDepth)
        sideBar.castShadow = true
        cradleGroup.add(sideBar)
    }

    const crossBarGeom = new THREE.CylinderGeometry(0.025, 0.025, config.frameDepth, 24)
    const crossBarOffset = structureLength * 0.5
    for (let xDir of [-1, 1]) {
        const crossBar = new THREE.Mesh(crossBarGeom, poleMaterial)
        crossBar.rotation.x = Math.PI * 0.5
        crossBar.position.set(xDir * crossBarOffset, config.topY, 0)
        crossBar.castShadow = true
        cradleGroup.add(crossBar)
    }

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

        const sphereGeometry = new THREE.SphereGeometry(radius, 48, 48)
        const sphereMaterial = new THREE.MeshStandardMaterial({
            color: 0xdddddd, metalness: 1.0, roughness: 0.02
        })
        const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
        sphere.castShadow = true
        sphere.receiveShadow = true
        cradleGroup.add(sphere)

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

    contactEpisodes = []
    for (let i = 0; i < bobs.length - 1; i++) {
        contactEpisodes.push({ active: false, approachSpeed: 0 })
    }
}

function stepPhysics(dt) {
    const L = parameters.stringLength
    const g = parameters.gravity

    for (let i = 0; i < bobs.length; i++) {
        const bob = bobs[i]

        const c_i = dragCoefficientForRadius(bob.radius)
        const angularAcceleration =
            - (g / L) * Math.sin(bob.theta)
            - (c_i / bob.mass) * bob.omega
            - (parameters.pivotFrictionB / (bob.mass * L * L)) * bob.omega

        bob.omega += angularAcceleration * dt
        bob.theta += bob.omega * dt

        const sin = Math.sin(bob.theta)
        const cos = Math.cos(bob.theta)
        bob.x = bob.anchorX + L * sin
        bob.y = config.topY - L * cos

        bob.vx = L * bob.omega * cos
        bob.vy = L * bob.omega * sin
    }

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
                const deltaRaw = minDistance - distance

                const maxDelta = 0.35 * Math.min(b1.radius, b2.radius)
                const delta = Math.min(deltaRaw, maxDelta)

                if (delta > 0) {
                    const kh = computeHertzStiffness(b1.radius, b2.radius) * parameters.stiffnessSoftening
                    const hertzForceMagnitude = kh * Math.pow(delta, 1.5)

                    const nx = dx / (distance || 1)
                    const ny = dy / (distance || 1)

                    const rvx = b2.vx - b1.vx
                    const rvy = b2.vy - b1.vy
                    const vNormal = rvx * nx + rvy * ny

                    if (pass === 0) {
                        if (!episode.active && vNormal < -0.01) {
                            episode.active = true
                            episode.approachSpeed = Math.abs(vNormal)
                            playClackSound(episode.approachSpeed)
                        }
                    }

                    const meff = (b1.mass * b2.mass) / (b1.mass + b2.mass)
                    const dampingForce = - parameters.contactDamping * (2 * meff) * vNormal * Math.sqrt(delta)
                    const totalForce = Math.max(0, hertzForceMagnitude + dampingForce)

                    const a1 = totalForce / b1.mass
                    const a2 = totalForce / b2.mass

                    b1.vx -= a1 * nx * dt
                    b1.vy -= a1 * ny * dt
                    b2.vx += a2 * nx * dt
                    b2.vy += a2 * ny * dt

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
                        const dx2 = b2.x - b1.x
                        const dy2 = b2.y - b1.y
                        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
                        const nx2 = dx2 / dist2
                        const ny2 = dy2 / dist2
                        const rvx2 = b2.vx - b1.vx
                        const rvy2 = b2.vy - b1.vy
                        const vSep = rvx2 * nx2 + rvy2 * ny2

                        if (episode.approachSpeed > 0.01 && vSep > 0) {
                             const calculatedE = vSep / episode.approachSpeed
                             if (calculatedE < 1.0) {
                                    parameters.lastMeasuredE = calculatedE
                            }
                        }
                        episode.active = false
                    }
                }
            }
        }
    }
}

function computeEnergies() {
    const L = parameters.stringLength
    const g = parameters.gravity

    let U = 0
    let K = 0

    for (const bob of bobs) {
        const potential = bob.mass * g * L * (1 - Math.cos(bob.theta))
        const v = L * bob.omega
        const kinetic = 0.5 * bob.mass * v * v

        U += potential
        K += kinetic
    }

    return {
        U,
        K,
        total: U + K
    }
}

function updateVisuals() {
    for (let i = 0; i < bobs.length; i++) {
        const bob = bobs[i]
        bob.mesh.position.set(bob.x, bob.y, 0)

        bob.ropePoints[1].set(bob.x, bob.y, 0)
        bob.ropeGeometry.setFromPoints(bob.ropePoints)
    }
}

setupCradle()

const gui = new dat.GUI({ width: 380 })

const caseFolder = gui.addFolder(' Study Cases')
caseFolder.add(parameters, 'caseSingleBall').name('Single Ball')
caseFolder.add(parameters, 'caseTwoBalls').name('Two Balls')
caseFolder.add(parameters, 'caseMiniSystem').name('Mini 3-Ball System')
caseFolder.add(parameters, 'caseUnequalMasses').name('Unequal Masses')
caseFolder.add(parameters, 'caseRealisticDamping').name('Realistic Damped System')
caseFolder.open()

const envFolder = gui.addFolder('Environment Configuration')
envFolder.add(parameters, 'gravity').min(0).max(25).step(0.1).name('Gravity g (m/s²)')
envFolder.add(parameters, 'airResistanceC').min(0).max(0.5).step(0.005).name('Air Resistance c')
envFolder.add(parameters, 'pivotFrictionB').min(0).max(0.2).step(0.005).name('Pivot Friction b')
envFolder.add(parameters, 'enableSound').name('Enable Clack Sound')
envFolder.open()

const setupFolder = gui.addFolder('Cradle Assembly Setup')
setupFolder.add(parameters, 'count').min(2).max(MAX_BALLS).step(1).name('Total Balls Count').onChange(() => setupCradle())
setupFolder.add(parameters, 'launchBalls').min(1).max(MAX_BALLS - 1).step(1).name('Balls to Drop').onChange((val) => {
    if (val >= parameters.count) parameters.launchBalls = parameters.count - 1
})
setupFolder.add(parameters, 'launchAngleDeg').min(5).max(75).step(1).name('Drop Angle (°)').onChange(() => setupCradle())
setupFolder.add(parameters, 'stringLength').min(1.5).max(3.0).step(0.05).name('String Length (m)').onChange(() => setupCradle())
setupFolder.add(parameters, 'launch').name('Drop / Reset Cradle')
setupFolder.open()

const massFolder = gui.addFolder(' Ball Masses ')
for (let i = 0; i < MAX_BALLS; i++) {
    massFolder.add(parameters.ballMasses, i).min(1).max(5.0).step(0.1).name(`Ball ${i + 1} Mass (kg)`).onChange(() => setupCradle())
}
massFolder.add(parameters, 'equalizeMasses').name('Reset All to 1 kg')

const validationFolder = gui.addFolder('Live Validation')

const potentialController = validationFolder
    .add(parameters, 'potentialEnergy')
    .name('Potential Energy U (J)')
    .listen()
potentialController.__precision = 1

const kineticController = validationFolder
    .add(parameters, 'kineticEnergy')
    .name('Kinetic Energy K (J)')
    .listen()
kineticController.__precision = 1

const energyController = validationFolder
    .add(parameters, 'totalEnergy')
    .name('Total Energy U+K (J)')
    .listen()
energyController.__precision = 1

const eController = validationFolder
    .add(parameters, 'lastMeasuredE')
    .name('Measured e (last hit)')
    .listen()
eController.__precision = 5 

validationFolder.open()

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

    const energies = computeEnergies()

    parameters.potentialEnergy = energies.U
    parameters.kineticEnergy = energies.K
    parameters.totalEnergy = energies.total

    updateVisuals()
    controls.update()
    renderer.render(scene, camera)

    window.requestAnimationFrame(tick)
}

tick()