import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'

/**
 * Debug controls & Core Physics Parameters matching the study
 */
const parameters = {
    gravity: 9.81,
    angularDamping: 0.15,         // Air resistance / pivot friction
    hertzStiffness: 4e6,          // Material stiffness coefficient (Kh) from Hertzian Theory
    contactDamping: 15.0,         // Viscoelastic damping during compression micro-seconds
    physicsHz: 2000,              // High frequency required to stabilize microscopic Hertzian forces
    count: 5,                     // Number of balls
    launchBalls: 1,               // Number of balls to lift
    launchAngleDeg: 30,
    enableSound: true,            // Toggle sound effects
    launch: () => setupCradle()   // Trigger re-initialization
}

// Canvas & Scene setup
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdde4ec)

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
camera.position.set(0, 1.85, 4.5)
scene.add(camera)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
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
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
scene.add(ambientLight)

const keyLight = new THREE.DirectionalLight(0xffffff, 1.0)
keyLight.position.set(5, 8, 5)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2024, 2024)
scene.add(keyLight)

/**
 * Ground
 */
const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.8 })
)
ground.rotation.x = - Math.PI * 0.5
ground.position.y = -0.02
ground.receiveShadow = true
scene.add(ground)

/**
 * Web Audio API - Procedural Metallic Clack Generator
 */
let audioCtx = null

function playClackSound(intensity) {
    if (!parameters.enableSound || intensity < 0.05) return

    // Initialize audio context on first physical impact (browser privacy requirement)
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }

    // Resume context if suspended (common in modern browsers)
    if (audioCtx.state === 'suspended') {
        audioCtx.resume()
    }

    const now = audioCtx.currentTime
    
    // Create audio nodes
    const osc = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    
    // Metallic impact profile: high frequency base with a rapid decaying envelope
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(2200, now) 
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.015) // Rapid downward pitch bend mimic solid steel

    // Scale overall volume based on impact relative velocity intensity
    const maxVolume = Math.min(0.3, intensity * 0.15)
    gainNode.gain.setValueAtTime(maxVolume, now)
    gainNode.gain.exponentialRampToValueAtTime(0.00001, now + 0.025) // Super short decay for "click/clack" texture

    // Connect and execute sound synthesis thread
    osc.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    
    osc.start(now)
    osc.stop(now + 0.03)
}

/**
 * Newton's Cradle Architectural Configurations
 */
const config = {
    ballRadius: 0.25,
    stringLength: 1.5,
    topY: 2.2,
    frameDepth: 0.9
}

// Global structural groups and data tracking
let cradleGroup = new THREE.Group()
scene.add(cradleGroup)
let bobs = []

const ballGeometry = new THREE.SphereGeometry(config.ballRadius, 64, 64)
const ballMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.1 })
const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x323840, metalness: 0.5, roughness: 0.2 })
const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x222222 })

/**
 * Setup / Rebuild Cradle Architecture dynamically based on user controls
 */
function setupCradle() {
    // Clear old visual components from scene graph
    while(cradleGroup.children.length > 0) { 
        const obj = cradleGroup.children[0]
        cradleGroup.remove(obj) 
    }
    bobs = []

    const spacing = config.ballRadius * 2.001 // Microscopic structural gap clearance
    const totalWidth = (parameters.count - 1) * spacing

    // Build Supporting Top Rail Structure
    const topRail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, totalWidth + 0.8, 24), poleMaterial)
    topRail.rotation.z = Math.PI * 0.5
    topRail.position.set(0, config.topY, 0)
    topRail.castShadow = true
    cradleGroup.add(topRail)

    // Build Side Stand Legs
    const legGeom = new THREE.CylinderGeometry(0.035, 0.035, config.topY, 20)
    const legX = totalWidth * 0.5 + 0.3
    for(let side of [-1, 1]) {
        for(let zDir of [-1, 1]) {
            const leg = new THREE.Mesh(legGeom, poleMaterial)
            leg.position.set(side * legX, config.topY * 0.5, zDir * config.frameDepth * 0.4)
            leg.castShadow = true
            cradleGroup.add(leg)
        }
    }

    // Instantiate State Arrays for Individual Pendulum Bobs
    for(let i = 0; i < parameters.count; i++) {
        const anchorX = (i - (parameters.count - 1) * 0.5) * spacing
        
        // Renderable Visual Node elements
        const sphere = new THREE.Mesh(ballGeometry, ballMaterial)
        sphere.castShadow = true
        sphere.receiveShadow = true
        cradleGroup.add(sphere)

        const ropePoints = [new THREE.Vector3(anchorX, config.topY, 0), new THREE.Vector3()]
        const ropeGeometry = new THREE.BufferGeometry().setFromPoints(ropePoints)
        const rope = new THREE.Line(ropeGeometry, ropeMaterial)
        cradleGroup.add(rope)

        // Physics State tracking properties conforming to analytical report
        const bob = {
            anchorX: anchorX,
            theta: 0,
            omega: 0,
            radius: config.ballRadius,
            mass: 1.0,
            x: anchorX,
            y: config.topY - config.stringLength,
            vx: 0,
            vy: 0,
            mesh: sphere,
            ropeGeometry: ropeGeometry,
            ropePoints: ropePoints,
            inContactLastFrame: false // Tracking variable to prevent repeated trigger spamming within a compression cycle
        }

        // Apply initial lifting displacement to specific selected balls (Discrete State Transition)
        if (i < parameters.launchBalls) {
            bob.theta = - THREE.MathUtils.degToRad(parameters.launchAngleDeg)
            const sin = Math.sin(bob.theta)
            const cos = Math.cos(bob.theta)
            bob.x = bob.anchorX + config.stringLength * sin
            bob.y = config.topY - config.stringLength * cos
            bob.vx = config.stringLength * bob.omega * cos
            bob.vy = config.stringLength * bob.omega * sin
        }

        bobs.push(bob)
    }
}

/**
 * Complete Physics Engine utilizing Finite State Mechanics & Non-Linear Hertz Theory
 */
function stepPhysics(dt) {
    const L = config.stringLength
    const g = parameters.gravity

    // --- PHASE 1: Continuous Domain Domain Solving (Pendulum Equations with Friction) ---
    for(let i = 0; i < bobs.length; i++) {
        const bob = bobs[i]

        // Angular Restoration Torque Equation combined with Damping Coefficient
        const angularAcceleration = - (g / L) * Math.sin(bob.theta) - parameters.angularDamping * bob.omega
        
        // Semi-implicit Euler integration for stable energy cycles
        bob.omega += angularAcceleration * dt
        bob.theta += bob.omega * dt

        // Map Angular Position components directly back into Cartesian Coordinates
        const sin = Math.sin(bob.theta)
        const cos = Math.cos(bob.theta)
        bob.x = bob.anchorX + L * sin
        bob.y = config.topY - L * cos

        // Convert current Angular Velocities into linear components
        bob.vx = L * bob.omega * cos
        bob.vy = L * bob.omega * sin
    }

    // --- PHASE 2: Discrete Contact Domain Solving (Hertz Mechanical Interpenetration Forces) ---
    // Multi-pass constraint validation handling cascading chain collisions simultaneously
    for (let pass = 0; pass < 4; pass++) {
        for(let i = 0; i < bobs.length - 1; i++) {
            const b1 = bobs[i]
            const b2 = bobs[i+1]

            // Find current physical delta values between neighboring surfaces
            const dx = b2.x - b1.x
            const dy = b2.y - b1.y
            const distance = Math.sqrt(dx*dx + dy*dy)
            const minDistance = b1.radius + b2.radius

            // Check if spheres are interpenetrating (Deformation Area delta exists)
            if(distance < minDistance) {
                const delta = minDistance - distance // Micro-deformation depth (𝛿)

                if(delta > 0) {
                    // Compute Hertzian Non-Linear Normal Forces: F = Kh * 𝛿^(1.5)
                    const hertzForceMagnitude = parameters.hertzStiffness * Math.pow(delta, 1.5)

                    // Find Normal projection vectors
                    const nx = dx / (distance || 1)
                    const ny = dy / (distance || 1)

                    // Calculate relative velocity projected along impact normals
                    const rvx = b2.vx - b1.vx
                    const rvy = b2.vy - b1.vy
                    const vNormal = rvx * nx + rvy * ny

                    // --- AUDITORY SENSOR EMISSION TRIGGER ---
                    // Trigger sound only during the initial frame of interpenetration to prevent continuous cycle sound generation loops
                    if (!b1.inContactLastFrame && vNormal < -0.01 && pass === 0) {
                        const impactSpeed = Math.abs(vNormal)
                        playClackSound(impactSpeed)
                    }

                    // Add Viscoelastic Damping Force to regulate elastic dissipation behavior
                    const dampingForce = - parameters.contactDamping * vNormal * Math.sqrt(delta)
                    const totalForce = Math.max(0, hertzForceMagnitude + dampingForce)

                    // Compute resulting Linear Accelerations (F / m)
                    const ax = totalForce * nx
                    const ay = totalForce * ny

                    // Modify individual Velocities based on applied Hertz interaction
                    b1.vx -= ax * dt
                    b1.vy -= ay * dt
                    b2.vx += ax * dt
                    b2.vy += ay * dt

                    // Reproject Modified Linear Vector changes back into constraints of Pendulum Angular System
                    const cos1 = Math.cos(b1.theta)
                    b1.omega = (b1.vx * cos1 + b1.vy * Math.sin(b1.theta)) / L
                    
                    const cos2 = Math.cos(b2.theta)
                    b2.omega = (b2.vx * cos2 + b2.vy * Math.sin(b2.theta)) / L
                    
                    b1.inContactLastFrame = true
                }
            } else {
                // Clear state once balls physically part ways out of the micro-deformation boundary
                if (pass === 0) b1.inContactLastFrame = false
            }
        }
    }
}

/**
 * Mirror computed abstract positions onto Renderable WebGL Meshes
 */
function updateVisuals() {
    for(let i = 0; i < bobs.length; i++) {
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

const envFolder = gui.addFolder('Environment Configuration')
envFolder.add(parameters, 'gravity').min(0).max(25).step(0.1).name('Gravity (g)')
envFolder.add(parameters, 'angularDamping').min(0).max(1).step(0.01).name('Air Resistance')
envFolder.add(parameters, 'enableSound').name('Enable Clack Sound')
envFolder.open()

const hertzFolder = gui.addFolder('Hertzian Contact Mechanics')
hertzFolder.add(parameters, 'hertzStiffness').min(1e5).max(1e7).step(1000).name('Stiffness (Kh)')
hertzFolder.add(parameters, 'contactDamping').min(0).max(50).step(0.1).name('Impact Absorption')
hertzFolder.add(parameters, 'physicsHz').min(1000).max(4000).step(100).name('Physics Precision (Hz)')
hertzFolder.open()

const setupFolder = gui.addFolder('Cradle Assembly Setup')
setupFolder.add(parameters, 'count').min(2).max(8).step(1).name('Total Balls Count').onChange(() => setupCradle())
setupFolder.add(parameters, 'launchBalls').min(1).max(7).step(1).name('Balls to Drop').onChange((val) => {
    if(val >= parameters.count) parameters.launchBalls = parameters.count - 1
})
setupFolder.add(parameters, 'launchAngleDeg').min(5).max(75).step(1).name('Drop Angle (°)').onChange(() => setupCradle())
setupFolder.add(parameters, 'launch').name('Drop / Reset Cradle')
setupFolder.open()

/**
 * Runtime Loop Engine Thread
 */
const clock = new THREE.Clock()
let accumulator = 0

const tick = () => {
    const delta = Math.min(clock.getDelta(), 0.033)
    accumulator += delta

    const physicsStep = 1 / parameters.physicsHz
    
    while(accumulator >= physicsStep) {
        stepPhysics(physicsStep)
        accumulator -= physicsStep
    }

    updateVisuals()
    controls.update()
    renderer.render(scene, camera)

    window.requestAnimationFrame(tick)
}

tick()