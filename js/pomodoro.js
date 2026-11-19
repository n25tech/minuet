
class TimeObject {
	constructor(duration) {
		this.duration = duration;
		this.startTime = null;
		this.endTime = null;
		//this.elapsedSeconds = null;
		this.remainingSeconds = null;
	}
	start() {
		this.startTime = Date.now();
		this.endTime = this.startTime + (this.duration * 60 * 1000);
	}

	pause() {
		//this.elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
		this.remainingSeconds = Math.floor((this.endTime - Date.now()) / 1000);
		this.endTime = null;
	}

	resume() {
		this.endTime = Date.now() + (this.remainingSeconds * 1000);
	}

	reset() {
		this.startTime = null;
		this.endTime = null;
		//this.elapsedSeconds = null;
		this.remainingSeconds = null;
	}

	liveRemainingSeconds() {
		if (this.endTime) {
			return Math.floor((this.endTime - Date.now()) / 1000);
		}
	}

}

/* The lengths offered on the Pomodoro card; the choice is kept per device. */
const POMODORO_DURATIONS = [2, 5, 15, 25, 45, 60];
const POMODORO_DEFAULT_DURATION = 25;
const POMODORO_DURATION_KEY = 'pomodoro_duration';

function savedPomodoroDuration() {
	try {
		const saved = Number(localStorage.getItem(POMODORO_DURATION_KEY));
		return POMODORO_DURATIONS.includes(saved) ? saved : POMODORO_DEFAULT_DURATION;
	} catch {
		return POMODORO_DEFAULT_DURATION;
	}
}

class PomodoroTimer {
	constructor(duration = savedPomodoroDuration(), displayId = 'pomodoro-timer-display', buttonId = 'pomodoro-toggle-button', durationsId = 'pomodoro-durations') {
		this.pom_duration_min = duration;
		this.durationButtons = [...(document.getElementById(durationsId)?.querySelectorAll('[data-minutes]') || [])];
		this.timerId = null;
		this.timeObj = new TimeObject(duration);
		this.status = 'new';
		this.displayElement = document.getElementById(displayId) || null;
		this.buttonElement = document.getElementById(buttonId) || null;
	}

	loadState() {
		let stateObject = localStorage.getItem('pomodoro_state') ? JSON.parse(localStorage.getItem('pomodoro_state')) : { status: 'new', time: new TimeObject(this.pom_duration_min) };
		this.timeObj = Object.assign(new TimeObject(this.pom_duration_min), stateObject.time);
		this.status = stateObject.status;
	}

	saveState() {
		let stateObject = {
			time: this.timeObj,
			status: this.status
		};
		localStorage.setItem('pomodoro_state', JSON.stringify(stateObject));
	}

	deleteState() {
		localStorage.removeItem('pomodoro_state');
		//this.stateObject = null;
	}

	init() {
		this.loadState();
		this.durationButtons.forEach(button =>
			button.addEventListener('click', () => this.setDuration(Number(button.dataset.minutes))));
		this.updateUI();
		// A session that was running when the page was closed keeps counting down.
		if (this.status === 'running') this.runTimer();
		return this;
	}

	/* Choose the length of the next pomodoro. Only between sessions, not while one is running or paused. */
	setDuration(minutes) {
		if (this.status !== 'new' || !POMODORO_DURATIONS.includes(minutes)) return false;
		this.pom_duration_min = minutes;
		this.timeObj = new TimeObject(minutes);
		try {
			localStorage.setItem(POMODORO_DURATION_KEY, String(minutes));
		} catch { /* storage blocked: the choice still applies for this visit */ }
		this.updateUI();
		return true;
	}

	endPomodoro() {
		console.log('pomodoro ended:', this.stateObject);
		alert('Pomodoro ended!');
		this.reset();
	}

	runTimer() {
		this.timerId = setInterval(() => {
			if (this.status === 'running' && this.timeObj.endTime <= Date.now()) {
				this.endPomodoro();
				this.updateUI();
			}
			this.updateUI();
		},
			1000);
	}

	handleToggleBtn() {
		if (this.status === 'running') {
			this.pause();
		} else if (this.status === 'paused') {
			this.resume();
		} else if (this.status === 'new') {
			this.start();
		} else {
			console.error('Unknown status:', this.stateObject);
		}
	}

	start() {
		this.startEngine();
	}

	pause() {
		this.pauseEngine();
	}

	resume() {
		this.resumeEngine();
	}

	reset() {
		this.resetEngine();
	}

	startEngine() {
		if (this.status !== 'new') return;
		if (this.timerId) clearInterval(this.timerId);
		this.timeObj.start();
		this.status = 'running';
		this.saveState();
		this.updateUI();
		this.runTimer();
		console.log('started pomodoro:', this.stateObject);
	}

	pauseEngine() {
		if (this.status !== 'running') {
			console.error('cannot pause, pomodoro is not running!');
			return;
		}
		this.timeObj.pause();
		this.status = 'paused';
		this.saveState();
		this.updateUI();
		console.log('paused pomodoro:', this.stateObject);
	}

	resumeEngine() {
		if (this.status !== 'paused') {
			console.error('cannot resume, pomodoro is not paused!');
			return;
		}
		this.timeObj.resume();
		this.status = 'running';
		this.saveState();
		this.updateUI();
		console.log('resumed pomodoro:', this.stateObject);
	}

	resetEngine() {
		// Back to the chosen length, even if the session that just ended was a different one.
		this.timeObj = new TimeObject(this.pom_duration_min);
		/*
		this.stateObject = this.resetStateObject;
		this.saveState();
		*/
		this.deleteState();
		if (this.timerId) {
			clearInterval(this.timerId);
			this.timerId = null;
		}
		this.status = 'new';
		this.updateUI();
		console.log('reset pomodoro:', this.stateObject);
	}

	// --- UPDATED UI LAYER ---
	updateUI() {
		let secondsToShow = this.timeObj.remainingSeconds;
		if (this.status === 'running') {
			secondsToShow = this.timeObj.liveRemainingSeconds();
		}
		this.render(secondsToShow);
		this.updateButtonText(); // Always sync the button text with the status
		this.updateDurationButtons();
	}

	updateDurationButtons() {
		// While a session is on, show its own length and lock the choice.
		const current = this.status === 'new' ? this.pom_duration_min : this.timeObj.duration;
		this.durationButtons.forEach(button => {
			button.setAttribute('aria-pressed', String(Number(button.dataset.minutes) === current));
			button.disabled = this.status !== 'new';
		});
	}

	updateButtonText() {
		if (!this.buttonElement) return;

		// Change what the button says based on internal state
		if (this.status === 'running') {
			this.buttonElement.textContent = 'Pause';
		} else if (this.status === 'paused') {
			this.buttonElement.textContent = 'Resume';
		} else {
			this.buttonElement.textContent = 'Start';
		}
	}

	render(totalSeconds) {
		if (!this.displayElement) return;
		if (totalSeconds === undefined || totalSeconds === null) {
			totalSeconds = this.pom_duration_min * 60; // default to full duration if no time provided
		}
		const displaySeconds = Math.max(0, totalSeconds);
		const mins = Math.floor(displaySeconds / 60).toString().padStart(2, '0');
		const secs = (displaySeconds % 60).toString().padStart(2, '0');
		this.displayElement.textContent = `${mins}:${secs}`;
	}
}

let pomodoroTimer;

document.addEventListener('DOMContentLoaded', () => {
	pomodoroTimer = new PomodoroTimer().init();
});
