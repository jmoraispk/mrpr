import { Extension } from '@tiptap/core'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef } from 'react'

import type { ReplyBoxProps } from './ReplyBox'
import { toMarkdown } from './richMarkdown'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

type Format = 'bold' | 'italic' | 'strike' | 'code' | 'link'

/**
 * The rich reply box: formats show as you type (Ctrl+B, I, Shift+X, E, K;
 * lists from "- " or "1. "), and what is posted is Markdown.
 */
export default function RichReply({
  label,
  value,
  onChange,
  onSubmit,
  autoFocus,
  initial,
  disabled,
}: ReplyBoxProps) {
  const submit = useRef(onSubmit)
  const askLink = useRef<() => void>(() => {})
  useEffect(() => {
    submit.current = onSubmit
  })
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
        // GitLab Markdown has no underline.
        underline: false,
        link: { openOnClick: false, autolink: true, linkOnPaste: true },
      }),
      Extension.create({
        name: 'replyKeys',
        addKeyboardShortcuts: () => ({
          'Mod-Enter': () => {
            submit.current()
            return true
          },
          'Mod-Shift-x': ({ editor: e }) => e.commands.toggleStrike(),
          'Mod-k': () => {
            askLink.current()
            return true
          },
        }),
      }),
    ],
    content: initial
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: initial }] }] }
      : '',
    autofocus: autoFocus ? 'end' : false,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        class: 'rich-reply-input',
      },
    },
    onUpdate: ({ editor: e }) => onChange(toMarkdown(e.getJSON())),
  })
  useEffect(() => {
    askLink.current = () => {
      if (!editor) return
      const previous = editor.getAttributes('link').href as string | undefined
      const href = window.prompt('Link address (empty removes the link)', previous ?? 'https://')
      if (href === null) return
      const chain = editor.chain().focus().extendMarkRange('link')
      if (!href.trim()) chain.unsetLink().run()
      else chain.setLink({ href: href.trim() }).run()
    }
  })
  // A post that went through clears the box.
  useEffect(() => {
    if (editor && value === '' && !editor.isEmpty) editor.commands.clearContent()
  }, [editor, value])
  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])
  const active = useEditorState({
    editor,
    selector: ({ editor: e }): Record<Format, boolean> => ({
      bold: e?.isActive('bold') ?? false,
      italic: e?.isActive('italic') ?? false,
      strike: e?.isActive('strike') ?? false,
      code: e?.isActive('code') ?? false,
      link: e?.isActive('link') ?? false,
    }),
  })
  const tools: [Format, string, string, string, () => void][] = [
    ['bold', 'Bold', 'B', `${MOD}B`, () => editor?.chain().focus().toggleBold().run()],
    ['italic', 'Italic', 'I', `${MOD}I`, () => editor?.chain().focus().toggleItalic().run()],
    ['strike', 'Strikethrough', 'S', `${MOD}Shift+X`, () => editor?.chain().focus().toggleStrike().run()],
    ['code', 'Code', '<>', `${MOD}E`, () => editor?.chain().focus().toggleCode().run()],
    ['link', 'Link', '🔗', `${MOD}K`, () => askLink.current()],
  ]
  return (
    <div className={`rich-reply${disabled ? ' is-disabled' : ''}`}>
      <div className="rich-reply-tools" role="toolbar" aria-label={`${label} formatting`}>
        {tools.map(([key, name, glyph, keys, run]) => (
          <button
            key={key}
            type="button"
            className={`rich-reply-tool is-${key}`}
            aria-label={`${name} (${keys})`}
            title={`${name} (${keys})`}
            aria-pressed={Boolean(active?.[key])}
            // Keep the selection: the editor must not lose it before the command.
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
            disabled={disabled}
          >
            {glyph}
          </button>
        ))}
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
