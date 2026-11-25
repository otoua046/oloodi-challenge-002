import { useState } from 'react'
import type { Worker } from '../shared/types'

const portraits: Record<string, string> = {
  'worker-001': 'jordan', 'worker-002': 'alex-chen', 'worker-003': 'alex-rivera',
}

export function Portrait({ worker }: { worker: Pick<Worker, 'id' | 'name'> }) {
  const [failed, setFailed] = useState(false)
  const photo = portraits[worker.id]
  return photo && !failed
    ? <img className="avatar" src={'/assets/' + photo + '.jpg'} alt="" onError={() => setFailed(true)} />
    : <span className="avatar initials" aria-hidden="true">{worker.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span>
}
