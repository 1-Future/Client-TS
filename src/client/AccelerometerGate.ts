// AccelerometerGate — BootScape movement gate
// Binary: isMoving() returns true if the player is physically walking.
// If the accelerometer is unavailable (desktop), isMoving() always returns true
// so desktop users are not blocked (they see the "use mobile" message instead).
// Fires onStart/onStop callbacks on transitions for smart queue + halt logic.
//
// Rate throttling: Android DeviceMotionEvent fires at 50-60 Hz, not 10 Hz.
// All counts below assume 10 Hz — enforced by SAMPLE_INTERVAL_MS.

const SAMPLE_INTERVAL_MS = 100; // enforce 10 Hz regardless of sensor fire rate
const WINDOW_SIZE = 20;         // ~2 seconds at 10 Hz
const MOVEMENT_THRESHOLD = 4.0; // m/s² — high enough to ignore hand tremor/micro-vibration
const START_DEBOUNCE = 3;       // consecutive above-threshold samples before onStart fires (~0.3s)
const STOP_DEBOUNCE = 50;       // consecutive below-threshold samples before onStop fires (~5s)

class AccelerometerGateImpl {
    private samples: number[] = [];
    private _moving = false;
    private _enabled = false;
    private _started = false;
    private _onStart: (() => void) | null = null;
    private _onStop: (() => void) | null = null;
    private _aboveCount = 0; // consecutive samples above threshold
    private _belowCount = 0; // consecutive samples below threshold
    private _lastSampleTime = 0; // for rate throttling

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
        // Throttle to 10 Hz — DeviceMotionEvent on Android fires at 50-60 Hz.
        // Without this, STOP_DEBOUNCE=30 would only be ~500ms at 60 Hz instead of 3s.
        const now = Date.now();
        if (now - this._lastSampleTime < SAMPLE_INTERVAL_MS) return;
        this._lastSampleTime = now;

        const magnitude = Math.sqrt(x * x + y * y + z * z);
        this.samples.push(magnitude);
        if (this.samples.length > WINDOW_SIZE) this.samples.shift();
        if (this.samples.length < 5) return;

        const max = Math.max(...this.samples);
        const min = Math.min(...this.samples);
        const variance = max - min;
        const rawMoving = variance > MOVEMENT_THRESHOLD;

        if (rawMoving) {
            this._aboveCount++;
            this._belowCount = 0;
        } else {
            this._belowCount++;
            this._aboveCount = 0;
        }

        if (!this._moving && this._aboveCount >= START_DEBOUNCE) {
            this._moving = true;
            this._onStart?.();
        } else if (this._moving && this._belowCount >= STOP_DEBOUNCE) {
            this._moving = false;
            this._onStop?.();
        }
    }
}

export const AccelerometerGate = new AccelerometerGateImpl();
