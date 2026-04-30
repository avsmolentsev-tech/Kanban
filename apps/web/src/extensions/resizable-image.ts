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

      const img = document.createElement('img');
      img.src = node.attrs.src;
      img.alt = node.attrs.alt || '';
      if (node.attrs.width) img.style.width = `${node.attrs.width}px`;
      else img.style.maxWidth = '100%';

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
              tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, width: finalWidth });
              return true;
            }).run();
          }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });

      container.appendChild(img);
      container.appendChild(handle);

      return {
        dom: container,
        update: (updatedNode) => {
          if (updatedNode.type.name !== 'image') return false;
          img.src = updatedNode.attrs.src;
          if (updatedNode.attrs.width) img.style.width = `${updatedNode.attrs.width}px`;
          return true;
        },
      };
    };
  },
});
