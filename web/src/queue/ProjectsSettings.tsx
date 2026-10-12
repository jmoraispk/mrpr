import { useState } from 'react'

import { deleteProject, exportProjects, importProjects } from './projects'
import { useProjects } from './state'

/** Projects in Settings: delete them, or carry them to another browser as JSON. */
export function ProjectsSettings() {
  const [projects, setProjects] = useProjects()
  // What the user typed or pasted; until then, the current list as a file.
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = draft ?? exportProjects(projects)

  function importFile() {
    try {
      setProjects(importProjects(file))
      setDraft(null)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Not a Mr. PR projects file')
    }
  }

  return (
    <section className="hub-section q-projects-settings">
      <h3 className="eyebrow">Projects</h3>
      <ul className="hub-list">
        {projects.map((project) => (
          <li key={project.id} className="hub-row">
            <span>
              <span className="q-dot" style={{ background: project.color }} />
              {project.name}
            </span>
            <button
              type="button"
              aria-label={`Delete ${project.name}`}
              onClick={() => {
                setProjects(deleteProject(projects, project.id))
                setDraft(null)
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <p className="hub-note">
        Projects live in this browser. Copy this to move them to another one, or paste one here to
        import.
      </p>
      <textarea
        aria-label="Projects file"
        rows={6}
        value={file}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={importFile}>
        Import
      </button>
      {error ? (
        <p className="hub-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
