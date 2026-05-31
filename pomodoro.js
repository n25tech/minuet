let pom_duration_min = 25;
			let stateObject = localStorage.getItem('pomodoro_state')? JSON.parse(localStorage.getItem('pomodoro_state')) :{"start_time": 0, "end_time": 0, "state": 'new'};
			let timerId = null;
			startPomodoro = () => {
				if (stateObject.state == 'running') {
					console.log('pomodoro is already running!');
					runTimer(stateObject);
					return;
				}
				let currentTime = Date.now();
				let endTime = currentTime + (pom_duration_min * 60 * 1000);
				stateObject = {"start_time": currentTime, "end_time": endTime, "state": 'running'};
				localStorage.setItem('pomodoro_state', JSON.stringify(stateObject));
				runTimer(stateObject);
				console.log('started pomodoro:', stateObject);
			};
			displayTime = (time) => {
				if (time == null) {
					document.getElementById('pomodoro-timer-display').textContent = time
				} else {
					const mins = Math.floor(time/60).toString().padStart(2, '0');
					const secs = (time % 60).toString().padStart(2, '0');
					document.getElementById('pomodoro-timer-display').textContent = `${mins}:${secs}`;
				}
			};
			runTimer = (stateObject) => {
				if (stateObject.endTime === 0 || stateObject.state !== 'running') {
					return;
				};
				let timerId = setInterval(() => {
					currentTime = Date.now();
					endTime = stateObject.end_time;
					//timeLeft--;
					let timeLeft = Math.floor((endTime-currentTime) / 1000)
					displayTime(timeLeft);
					if (stateObject.state === 'running' && timeLeft <=0) {
						clearInterval(timerId);
						timerId = null;
						alert("Time's up!");
						localStorage.removeItem('pomodoro_state');
						console.log(`ended pomodoro from timeLeft, currenttime: ${currentTime} state: `, stateObject);
					}
					if (stateObject.state === 'running' && currentTime >= endTime) {
						clearInterval(timerId);
						timerId = null;
						alert("Time's up!");
						localStorage.removeItem('pomodoro_state');
						console.log(`ended pomodoro from endTime, currenttime: ${currentTime}, state: `, stateObject);
					};
				}, 1000);
			}
			runTimer(stateObject);

