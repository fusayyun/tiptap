import { Extension } from '@tiptap/core'
import { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export interface CharacterCountOptions {
  /**
   * The maximum number of characters that should be allowed. Defaults to `0`.
   * @default null
   * @example 180
   */
  limit: number | null | undefined
  /**
   * The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
   * If set to `nodeSize`, the nodeSize of the document is used.
   * @default 'textSize'
   * @example 'textSize'
   */
  mode: 'textSize' | 'nodeSize'
  /**
 * The text counter function to use. Defaults to a simple character count.
 * @default (text) => text.length
 * @example (text) => [...new Intl.Segmenter().segment(text)].length
 */
  textCounter: (text: string) => number
  /**
   * The word counter function to use. Defaults to a simple word count.
   * @default (text) => text.split(' ').filter(word => word !== '').length
   * @example (text) => text.split(/\s+/).filter(word => word !== '').length
   */
  wordCounter: (text: string) => number
}

export interface CharacterCountStorage {
  /**
   * Get the number of characters for the current document.
   * @param options The options for the character count. (optional)
   * @param options.node The node to get the characters from. Defaults to the current document.
   * @param options.mode The mode by which the size is calculated. If set to `textSize`, the textContent of the document is used.
   */
  characters: (options?: { node?: ProseMirrorNode; mode?: 'textSize' | 'nodeSize' }) => number

  /**
   * Get the number of words for the current document.
   * @param options The options for the character count. (optional)
   * @param options.node The node to get the words from. Defaults to the current document.
   */
  words: (options?: { node?: ProseMirrorNode }) => number
}

/**
 * This extension allows you to count the characters and words of your document.
 * @see https://tiptap.dev/api/extensions/character-count
 */
export const CharacterCount = Extension.create<CharacterCountOptions, CharacterCountStorage>({
  name: 'characterCount',

  addOptions() {
    return {
      limit: null,
      mode: 'textSize',
      textCounter: text => text.length,
      wordCounter: text => text.split(' ').filter(word => word !== '').length,
    }
  },

  addStorage() {
    return {
      characters: () => 0,
      words: () => 0,
    }
  },

  onBeforeCreate() {
    this.storage.characters = options => {
      const node = options?.node || this.editor.state.doc
      const mode = options?.mode || this.options.mode

      if (mode === 'textSize') {
        const text = node.textBetween(0, node.content.size, undefined, ' ')

        return this.options.textCounter(text)
      }

      return node.nodeSize
    }

    this.storage.words = options => {
      const node = options?.node || this.editor.state.doc
      const text = node.textBetween(0, node.content.size, ' ', ' ')

      return this.options.wordCounter(text)
    }
  },

  addProseMirrorPlugins() {
    
    let isComposing: boolean

    const { storage: { characters }, options: { limit } } = this
    
    return [
      new Plugin({
        key: new PluginKey('characterCount'),
        handleDOMEvents: {
            compositionstart() {
              isComposing = true
            },
            compositionend(view) {
              isComposing = false

              if (!limit) {
                return true
              }
             
              const { state, dispatch } = view;
              const { tr } = state;

              const size = characters({ node: tr.doc })
              
              if (size > limit) {
                
                const pos = tr.selection.$head.pos
                const over = size - limit
                const from = Math.max(0, pos - over)  // Ensure `from` is not negative
                const to = pos
                
                const transaction = tr.deleteRange(from, to)
                // Dispatch the transaction to update the document
                dispatch(transaction)
                
                // Prevent the default compositionend behavior
                return false
              }

              return true

            }  
          },
        },
        filterTransaction: (transaction, state) => {
          // Ignore it when composing.
          if (isComposing) {
            return true
          }
                 
          // Nothing has changed or no limit is defined. Ignore it.
          if (!transaction.docChanged || limit === 0 || limit === null || limit === undefined) {
            return true
          }

          const oldSize = this.storage.characters({ node: state.doc })
          const newSize = this.storage.characters({ node: transaction.doc })

          // Everything is in the limit. Good.
          if (newSize <= limit) {
            return true
          }

          // The limit has already been exceeded but will be reduced.
          if (oldSize > limit && newSize > limit && newSize <= oldSize) {
            return true
          }

          // The limit has already been exceeded and will be increased further.
          if (oldSize > limit && newSize > limit && newSize > oldSize) {
            return false
          }

          const isPaste = transaction.getMeta('paste')

          // Block all exceeding transactions that were not pasted.
          if (!isPaste) {
            return false
          }

          // For pasted content, we try to remove the exceeding content.
          const pos = transaction.selection.$head.pos
          const over = newSize - limit
          const from = pos - over
          const to = pos

          // It’s probably a bad idea to mutate transactions within `filterTransaction`
          // but for now this is working fine.
          transaction.deleteRange(from, to)

          // In some situations, the limit will continue to be exceeded after trimming.
          // This happens e.g. when truncating within a complex node (e.g. table)
          // and ProseMirror has to close this node again.
          // If this is the case, we prevent the transaction completely.
          const updatedSize = this.storage.characters({ node: transaction.doc })

          if (updatedSize > limit) {
            return false
          }

          return true
        },
      }),
    ]
  },
})
