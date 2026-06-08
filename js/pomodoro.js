
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

class PomodoroTimer {
	constructor(duration = 25, displayId = 'pomodoro-timer-display', buttonId = 'pomodoro-toggle-button') {
		this.pom_duration_min = duration;
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
		return this;
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
		this.timeObj.reset();
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
