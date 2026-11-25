import { useState } from 'react'

const photos: Record<string, string> = {
  'worker-001': 'jordan',
  'worker-002': 'alex-chen',
  'worker-003': 'alex-rivera',
}

export function Portrait({ id, name }: { id: string; name: string }) {
  const photo = photos[id]
  const [failedPhoto, setFailedPhoto] = useState<string>()
  if (photo && photo !== failedPhoto) {
    return <img className="avatar" src={'/assets/' + photo + '.jpg'} alt="" onError={() => setFailedPhoto(photo)} />
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
  return (
    <span className="avatar initials" aria-hidden="true">
      {initials}
    </span>
  )
}
