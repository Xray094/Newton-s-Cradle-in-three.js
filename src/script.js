import './style.css'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import * as dat from 'dat.gui'

/**
 * Debug controls
 */
const parameters = {
    gravity: 9.81,
    angularDamping: 0.0012,
    contactRestitution: 0.999,
    impactVelocityDamping: 0.0008,
    physicsHz: 720,
    collisionIterations: 16,
    launchBalls: 1,
    launchAngleDeg: 20,
    autoSwing: false
}

// Canvas
const canvas = document.querySelector('canvas.webgl')

// Scene
const scene = new THREE.Scene()
scene.background = new THREE.Color(0xdde4ec)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight
}

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight

    // Update camera
    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    // Update renderer
    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
})

/**
 * Camera
 */
const camera = new THREE.PerspectiveCamera(45, sizes.width / sizes.height, 0.1, 100)
camera.position.set(0, 1.85, 6.2)
scene.add(camera)

// Controls
const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.target.set(0, 0.95, 0)
controls.minDistance = 3
controls.maxDistance = 12
controls.maxPolarAngle = Math.PI * 0.48

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas
})
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputEncoding = THREE.sRGBEncoding

/**
 * Lights
 */
const ambientLight = new THREE.AmbientLight(0xffffff, 0.56)
scene.add(ambientLight)

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2)
keyLight.position.set(3.8, 5.5, 2.6)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(1024, 1024)
keyLight.shadow.camera.left = -4
keyLight.shadow.camera.right = 4
keyLight.shadow.camera.top = 4
keyLight.shadow.camera.bottom = -4
keyLight.shadow.camera.near = 0.5
keyLight.shadow.camera.far = 18
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffffff, 0.35)
fillLight.position.set(-3, 2, -4)
scene.add(fillLight)

/**
 * Ground
 */
const ground = new THREE.Mesh(
    new THREE.PlaneBufferGeometry(14, 14),
    new THREE.MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.95, metalness: 0.06 })
)
ground.rotation.x = - Math.PI * 0.5
ground.position.y = -0.02
ground.receiveShadow = true
scene.add(ground)

/**
 * Newton's Cradle setup
 */
const cradleConfig = {
    count: 5,
    ballRadius: 0.28,
    spacing: 0.58,
    stringLength: 1.5,
    topY: 2.2,
    frameHeight: 1.8,
    frameDepth: 0.9,
    bottomTolerance: 0.075
}

const ballGeometry = new THREE.SphereBufferGeometry(cradleConfig.ballRadius, 48, 48)
const ballMaterial = new THREE.MeshStandardMaterial({
    color: 0xe7ecf2,
    metalness: 0.9,
    roughness: 0.2
})

const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x323840,
    metalness: 0.25,
    roughness: 0.58
})

const ropeMaterial = new THREE.LineBasicMaterial({ color: 0x12161a })

const cradleWidth = (cradleConfig.count - 1) * cradleConfig.spacing
const cradleGroup = new THREE.Group()
scene.add(cradleGroup)

const topRail = new THREE.Mesh(
    new THREE.CylinderBufferGeometry(0.05, 0.05, cradleWidth + 1.1, 24),
    poleMaterial
)
topRail.rotation.z = Math.PI * 0.5
topRail.position.set(0, cradleConfig.topY, 0)
topRail.castShadow = true
cradleGroup.add(topRail)

const baseRail = new THREE.Mesh(
    new THREE.CylinderBufferGeometry(0.055, 0.055, cradleWidth + 1.55, 24),
    poleMaterial
)
baseRail.rotation.z = Math.PI * 0.5
baseRail.position.set(0, cradleConfig.topY - cradleConfig.frameHeight, cradleConfig.frameDepth * 0.45)
baseRail.castShadow = true
cradleGroup.add(baseRail)

const backBaseRail = baseRail.clone()
backBaseRail.position.z = - cradleConfig.frameDepth * 0.45
cradleGroup.add(backBaseRail)

const legGeometry = new THREE.CylinderBufferGeometry(0.045, 0.045, cradleConfig.frameHeight, 20)
const legX = cradleWidth * 0.5 + 0.42

for(const side of [-1, 1])
{
    for(const zDir of [-1, 1])
    {
        const leg = new THREE.Mesh(legGeometry, poleMaterial)
        leg.position.set(side * legX, cradleConfig.topY - cradleConfig.frameHeight * 0.5, zDir * cradleConfig.frameDepth * 0.45)
        leg.castShadow = true
        cradleGroup.add(leg)
    }
}

const crossBar = new THREE.Mesh(
    new THREE.CylinderBufferGeometry(0.04, 0.04, cradleConfig.frameDepth * 0.95, 20),
    poleMaterial
)
crossBar.rotation.x = Math.PI * 0.5
crossBar.position.set(- legX, cradleConfig.topY - cradleConfig.frameHeight * 0.55, 0)
crossBar.castShadow = true
cradleGroup.add(crossBar)

const rightCrossBar = crossBar.clone()
rightCrossBar.position.x = legX
cradleGroup.add(rightCrossBar)

const bobs = []

for(let i = 0; i < cradleConfig.count; i++)
{
    const anchorX = (i - (cradleConfig.count - 1) * 0.5) * cradleConfig.spacing
    const anchor = new THREE.Vector3(anchorX, cradleConfig.topY, 0)

    const sphere = new THREE.Mesh(ballGeometry, ballMaterial)
    sphere.castShadow = true
    sphere.receiveShadow = true
    cradleGroup.add(sphere)

    const ropePoints = [new THREE.Vector3(), new THREE.Vector3()]
    const ropeGeometry = new THREE.BufferGeometry().setFromPoints(ropePoints)
    const rope = new THREE.Line(ropeGeometry, ropeMaterial)
    cradleGroup.add(rope)

    bobs.push({
        anchor,
        ropeGeometry,
        ropePoints,
        mesh: sphere,
        mass: 1,
        invMass: 1,
        theta: 0,
        omega: 0,
        position: new THREE.Vector2(anchorX, cradleConfig.topY - cradleConfig.stringLength),
        previousPosition: new THREE.Vector2(anchorX, cradleConfig.topY - cradleConfig.stringLength),
        velocity: new THREE.Vector2()
    })
}

const tempAnchorToBall = new THREE.Vector2()
const tempNormal = new THREE.Vector2()
const tempRelativeVelocity = new THREE.Vector2()
const tempTangentA = new THREE.Vector2()
const tempTangentB = new THREE.Vector2()

const syncBobFromTheta = (bob) =>
{
    const sinTheta = Math.sin(bob.theta)
    const cosTheta = Math.cos(bob.theta)
    const length = cradleConfig.stringLength

    bob.position.set(
        bob.anchor.x + length * sinTheta,
        bob.anchor.y - length * cosTheta
    )

    bob.velocity.set(length * bob.omega * cosTheta, length * bob.omega * sinTheta)
}

const enforceStringConstraint = (bob) =>
{
    tempAnchorToBall.set(bob.position.x - bob.anchor.x, bob.position.y - bob.anchor.y)
    const currentLength = tempAnchorToBall.length()

    if(currentLength < 1e-7)
    {
        bob.position.set(bob.anchor.x, bob.anchor.y - cradleConfig.stringLength)
        bob.theta = 0
        return
    }

    const scale = cradleConfig.stringLength / currentLength
    bob.position.set(
        bob.anchor.x + tempAnchorToBall.x * scale,
        bob.anchor.y + tempAnchorToBall.y * scale
    )

    tempAnchorToBall.set(bob.position.x - bob.anchor.x, bob.anchor.y - bob.position.y)
    bob.theta = Math.atan2(tempAnchorToBall.x, tempAnchorToBall.y)
}

const projectVelocityToTangent = (bob, tangentTarget) =>
{
    tangentTarget.set(Math.cos(bob.theta), Math.sin(bob.theta))
    const tangentSpeed = bob.velocity.dot(tangentTarget)
    bob.velocity.copy(tangentTarget).multiplyScalar(tangentSpeed)
    bob.omega = tangentSpeed / cradleConfig.stringLength
}

const launch = () =>
{
    const angle = THREE.MathUtils.degToRad(parameters.launchAngleDeg)

    for(const bob of bobs)
    {
        bob.theta = 0
        bob.omega = 0
        syncBobFromTheta(bob)
        bob.previousPosition.copy(bob.position)
    }

    for(let i = 0; i < parameters.launchBalls; i++)
    {
        if(i >= bobs.length)
        {
            break
        }

        bobs[i].theta = - angle
        bobs[i].omega = 0
        syncBobFromTheta(bobs[i])
    }
}

const rebuildBobState = (bob) =>
{
    enforceStringConstraint(bob)
    projectVelocityToTangent(bob, tempTangentA)
}

const resolveBallCollision = (a, b) =>
{
    const minDistance = cradleConfig.ballRadius * 2
    tempNormal.set(b.position.x - a.position.x, b.position.y - a.position.y)
    const distanceSq = tempNormal.lengthSq()

    if(distanceSq >= minDistance * minDistance)
    {
        return
    }

    const distance = Math.sqrt(Math.max(distanceSq, 1e-12))
    if(distance > 1e-6)
    {
        tempNormal.multiplyScalar(1 / distance)
    }
    else
    {
        tempNormal.set(1, 0)
    }

    const overlap = minDistance - distance
    if(overlap > 0)
    {
        const invMassSum = a.invMass + b.invMass
        const correctionA = overlap * (a.invMass / invMassSum)
        const correctionB = overlap * (b.invMass / invMassSum)

        a.position.x -= tempNormal.x * correctionA
        a.position.y -= tempNormal.y * correctionA
        b.position.x += tempNormal.x * correctionB
        b.position.y += tempNormal.y * correctionB

        enforceStringConstraint(a)
        enforceStringConstraint(b)
    }

    projectVelocityToTangent(a, tempTangentA)
    projectVelocityToTangent(b, tempTangentB)

    tempRelativeVelocity.subVectors(b.velocity, a.velocity)
    const relativeNormalVelocity = tempRelativeVelocity.dot(tempNormal)

    if(relativeNormalVelocity >= 0)
    {
        return
    }

    const restitution = parameters.contactRestitution
    const impulseMagnitude = - (1 + restitution) * relativeNormalVelocity / (a.invMass + b.invMass)

    a.velocity.x -= impulseMagnitude * a.invMass * tempNormal.x
    a.velocity.y -= impulseMagnitude * a.invMass * tempNormal.y
    b.velocity.x += impulseMagnitude * b.invMass * tempNormal.x
    b.velocity.y += impulseMagnitude * b.invMass * tempNormal.y

    const impactDampingFactor = Math.max(0, 1 - parameters.impactVelocityDamping)
    a.velocity.multiplyScalar(impactDampingFactor)
    b.velocity.multiplyScalar(impactDampingFactor)

    rebuildBobState(a)
    rebuildBobState(b)
}

const stepPhysics = (dt) =>
{
    for(const bob of bobs)
    {
        bob.previousPosition.copy(bob.position)
        bob.omega += (- (parameters.gravity / cradleConfig.stringLength) * Math.sin(bob.theta) - parameters.angularDamping * bob.omega) * dt
        bob.theta += bob.omega * dt
        syncBobFromTheta(bob)
    }

    for(let i = 0; i < parameters.collisionIterations; i++)
    {
        for(let a = 0; a < bobs.length - 1; a++)
        {
            resolveBallCollision(bobs[a], bobs[a + 1])
        }
    }

    for(const bob of bobs)
    {
        syncBobFromTheta(bob)
    }
}

const updateVisuals = () =>
{
    for(const bob of bobs)
    {
        bob.mesh.position.set(bob.position.x, bob.position.y, 0)

        bob.ropePoints[0].copy(bob.anchor)
        bob.ropePoints[1].set(bob.position.x, bob.position.y, 0)
        bob.ropeGeometry.setFromPoints(bob.ropePoints)
    }
}

launch()
updateVisuals()

/**
 * Debug
 */
const gui = new dat.GUI({
    width: 400
})
gui.add(parameters, 'gravity').min(5).max(30).step(0.1)
gui.add(parameters, 'angularDamping').min(0).max(0.02).step(0.0001)
gui.add(parameters, 'contactRestitution').min(0.97).max(1).step(0.0001)
gui.add(parameters, 'impactVelocityDamping').min(0).max(0.01).step(0.0001)
gui.add(parameters, 'physicsHz').min(240).max(1440).step(10)
gui.add(parameters, 'collisionIterations').min(4).max(32).step(1)
gui.add(parameters, 'launchBalls').min(1).max(4).step(1)
gui.add(parameters, 'launchAngleDeg').min(5).max(55).step(1)
gui.add(parameters, 'autoSwing')
gui.add({ launch }, 'launch')

/**
 * Animate
 */
const clock = new THREE.Clock()
let accumulator = 0

const tick = () =>
{
    const delta = Math.min(clock.getDelta(), 0.033)
    accumulator += delta

    if(parameters.autoSwing)
    {
        const t = performance.now() * 0.001
        const targetTheta = - THREE.MathUtils.degToRad(parameters.launchAngleDeg) * Math.cos(t * 1.2)
        const targetOmega = THREE.MathUtils.degToRad(parameters.launchAngleDeg) * 1.2 * Math.sin(t * 1.2)
        bobs[0].theta = targetTheta
        bobs[0].omega = targetOmega
        syncBobFromTheta(bobs[0])
    }

    const physicsStep = 1 / parameters.physicsHz
    while(accumulator >= physicsStep)
    {
        stepPhysics(physicsStep)
        accumulator -= physicsStep
    }

    updateVisuals()

    // Update controls
    controls.update()

    // Render
    renderer.render(scene, camera)

    // Call tick again on the next frame
    window.requestAnimationFrame(tick)
}

tick()