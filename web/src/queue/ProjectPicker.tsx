import { useState } from 'react'

import { createProject, moveRow } from './projects'
import { useProjects } from './state'

/** Move one MR into a project, back to Unsorted, or into a new project. */
export function ProjectPicker({ rowKey, onDone }: { rowKey: string; onDone: () => void }) {
  const [projects, setProjects] = useProjects()
  const [name, setName] = useState('')
  const move = (id: string | null) => {
    setProjects(moveRow(projects, rowKey, id))
    onDone()
  }
  return (
    <div className="q-picker" role="group" aria-label="Move to project">
      {projects.map((project) => (
        <button key={project.id} type="button" onClick={() => move(project.id)}>
          <span className="q-dot" style={{ background: project.color }} />
          {project.name}
        </button>
      ))}
      <button type="button" onClick={() => move(null)}>
        Unsorted
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!name.trim()) return
          const created = createProject(projects, name)
          setProjects(moveRow(created, rowKey, created[created.length - 1].id))
          onDone()
        }}
      >
        <label htmlFor="q-new-project">New project</label>
        <input id="q-new-project" value={name} onChange={(event) => setName(event.target.value)} />
      </form>
    </div>
  )
}
