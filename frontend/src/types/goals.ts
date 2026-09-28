export type GoalStatus = 'done' | 'ahead' | 'on_track' | 'behind' | 'missed'

export interface GoalProgress {
  year: number
  target: number | null
  completed: number
  expected_by_now: number | null
  status: GoalStatus | null
  remaining: number | null
  per_month_needed: number | null
}

export const GOAL_STATUS: Record<GoalStatus, string> = {
  done: 'Goal reached',
  ahead: 'Ahead of pace',
  on_track: 'On pace',
  behind: 'Behind pace',
  missed: 'Goal missed',
}
