// AccelerometerGate — BootScape movement gate
// Binary: isMoving() returns true if the player is physically walking.
// If the accelerometer is unavailable (desktop), isMoving() always returns true
// so desktop users are not blocked (they see the "use mobile" message instead).
// Fires onStart/onStop callbacks on transitions for smart queue + halt logic.

const WINDOW_SIZE = 20; // ~2 seconds at 10 Hz
const MOVEMENT_THRESHOLD = 1.5; // m/s² variation required to count as moving

class AccelerometerGateImpl {
    private samples: number[] = [];
    private _moving = false;
    private _enabled = false;
    private _started = false;
    private _onStart: (() => void) | null = null;
    private _onStop: (() => void) | null = null;

    /** True once the accelerometer has been started and permissions granted. */
    get isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * Returns true if the player is allowed to move.
     * - Not enabled (desktop/no sensor): always true.
     * - Enabled: true only when walking motion is detected.
     */
    isMoving(): boolean {
        if (!this._enabled) return true;
        return this._moving;
    }

    /** Called once when transitioning from still → walking. */
    onStart(callback: () => void): void {
        this._onStart = callback;
    }

    /** Called once when transitioning from walking → still. */
    onStop(callback: () => void): void {
        this._onStop = callback;
    }

    /**
     * Start the accelerometer. Must be called from a user gesture (click/touch)
     * so iOS can show its permission prompt.
     */
    async start(): Promise<void> {
        if (this._started) return;
        this._started = true;

        // iOS 13+ requires explicit permission request from a user gesture
        if (typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as any).requestPermission === 'function') {
            try {
                const permission = await (DeviceMotionEvent as any).requestPermission();
                if (permission !== 'granted') return;
            } catch {
                return;
            }
        }

        // Try the modern Generic Sensor API (Chrome Android, some desktop)
        if ('Accelerometer' in window) {
            try {
                const sensor = new (window as any).Accelerometer({ frequency: 10 });
                sensor.addEventListener('reading', () => this.onSample(sensor.x, sensor.y, sensor.z));
                sensor.addEventListener('error', () => this.startDeviceMotion());
                sensor.start();
                this._enabled = true;
                return;
            } catch {
                // fall through to DeviceMotionEvent
            }
        }

        this.startDeviceMotion();
    }

    private startDeviceMotion(): void {
        if (!('DeviceMotionEvent' in window)) return;
        window.addEventListener('devicemotion', (e: DeviceMotionEvent) => {
            const a = e.accelerationIncludingGravity;
            if (a) this.onSample(a.x ?? 0, a.y ?? 0, a.z ?? 0);
        });
        this._enabled = true;
    }

    private onSample(x: number, y: number, z: number): void {
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        this.samples.push(magnitude);
        if (this.samples.length > WINDOW_SIZE) this.samples.shift();
        if (this.samples.length >= 5) {
            const max = Math.max(...this.samples);
            const min = Math.min(...this.samples);
            const wasMoving = this._moving;
            this._moving = max - min > MOVEMENT_THRESHOLD;
            if (this._moving && !wasMoving) this._onStart?.();
            if (!this._moving && wasMoving) this._onStop?.();
        }
    }
}

export const AccelerometerGate = new AccelerometerGateImpl();
