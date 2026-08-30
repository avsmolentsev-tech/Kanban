import Image from '@tiptap/extension-image';

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        renderHTML: (attributes) => {
          if (!attributes.width) return {};
          return { style: `width: ${attributes.width}px` };
        },
        parseHTML: (element) => {
          const width = element.style.width?.replace('px', '');
          return width ? parseInt(width, 10) : null;
        },
      },
    };
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const container = document.createElement('div');
      container.classList.add('image-resize-container');
      container.contentEditable = 'false';
      container.tabIndex = 0;

      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      else img.style.maxWidth = '100%';

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.classList.add('image-delete-btn');
      deleteBtn.innerHTML = '&times;';
      deleteBtn.title = 'Удалить';

      const deleteImage = () => {
        if (typeof getPos === 'function') {
          const pos = getPos();
          if (pos != null) {
            editor.chain().focus().command(({ tr }) => {
              tr.delete(pos, pos + 1);
              return true;
            }).run();
          }
        }
      };

      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteImage();
      });

      // Keyboard delete
      container.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          deleteImage();
        }
      });

      // Click to select (show handles)
      container.addEventListener('click', () => {
        container.classList.add('selected');
        container.focus();
      });

      container.addEventListener('blur', () => {
        container.classList.remove('selected');
      });

      // Resize handle
      const handle = document.createElement('div');
      handle.classList.add('image-resize-handle');

      let startX = 0;
      let startWidth = 0;

      handle.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();
        startX = e.clientX;
        startWidth = img.offsetWidth;

        const onMouseMove = (ev: MouseEvent) => {
          const newWidth = Math.max(100, startWidth + (ev.clientX - startX));
          img.style.width = `${newWidth}px`;
        };

        const onMouseUp = (ev: MouseEvent) => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          const finalWidth = Math.max(100, startWidth + (ev.clientX - startX));
          if (typeof getPos === 'function') {
            editor.chain().focus().command(({ tr }) => {
              const pos = getPos();
              if (pos != null) tr.setNodeMarkup(pos, undefined, { ...node.attrs, width: finalWidth });
              return true;
            }).run();
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      container.appendChild(img);
      container.appendChild(handle);
      container.appendChild(deleteBtn);

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          img.src = updatedNode.attrs.src;
          if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`;
          return true;
        },
        destroy: () => {
          container.remove();
        },
      };
    };
  },
});
