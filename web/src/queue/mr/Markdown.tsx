import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

const remarkPlugins = [remarkGfm]
const rehypePlugins = [rehypeRaw, rehypeSanitize]

/**
 * GitLab Markdown, sanitised as the review view's comments are, with GitLab's
 * relative links and uploads made absolute to the GitLab host.
 */
export function Markdown({ source, host, project }: { source: string; host: string; project: string }) {
  const origin = `https://${host}`
  const absolute = (url: string) => {
    const safe = defaultUrlTransform(url)
    if (!safe) return safe
    // Uploads in a description are relative to the project.
    if (safe.startsWith('/uploads/')) return `${origin}/${project}${safe}`
    if (safe.startsWith('/')) return `${origin}${safe}`
    return safe
  }
  return (
    <div className="mr-markdown">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        urlTransform={absolute}
        components={{
          a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
