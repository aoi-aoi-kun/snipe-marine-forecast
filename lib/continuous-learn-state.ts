export type ContinuousLearnStatus = {
  started: boolean;
  ticking: boolean;
  intervalMinutes: number;
  lastTickAt: string | null;
  lastTickError: string | null;
};

const state: ContinuousLearnStatus = {
  started: false,
  ticking: false,
  intervalMinutes: 10,
  lastTickAt: null,
  lastTickError: null,
};

export function getContinuousLearnStatus(): ContinuousLearnStatus {
  return { ...state };
}

export function setContinuousLearnStarted(started: boolean, intervalMinutes: number) {
  state.started = started;
  state.intervalMinutes = intervalMinutes;
}

export function setContinuousLearnTicking(ticking: boolean) {
  state.ticking = ticking;
}

export function setContinuousLearnTickResult(error: string | null) {
  state.lastTickAt = new Date().toISOString();
  state.lastTickError = error;
}
