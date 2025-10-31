import * as React from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import BubbleMenu from "@tiptap/extension-bubble-menu";
import { Mark } from "@tiptap/core";
import { Node } from "@tiptap/core";
import { EditorView } from "@tiptap/pm/view";
import { Node as PMNode } from "@tiptap/pm/model";

// MUI
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import Backdrop from "@mui/material/Backdrop";
import CircularProgress from "@mui/material/CircularProgress";


import { AIClient, WriterTone, RewriterTone, LangCode } from "./aiclient";
import type { Opty } from "./types/interfaces";

type TextAction = {
  (selectedText: string, code: string | null, callback: (rewritten: string) => void, ctx: { row?: Opty }): void;
};
type TextActionRegistry = {
  withCode?: TextAction;
  uppercase?: TextAction;
  wrapQuotes?: TextAction;
};

export interface TiptapActionsEditorProps {
  row?: Opty;
  initialContent?: string;
  actions?: Partial<TextActionRegistry>;
  className?: string;
  elevation?: number;
  title?: string;
}

/* ---------------------------
 *  (1) Mark: syntaxHint
 * --------------------------- */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    syntaxHint: {
      addSyntaxHint: () => ReturnType;
      clearSyntaxHints: () => ReturnType;
    };
  }
}

const SyntaxHint = Mark.create({
  name: "syntaxHint",
  inclusive: false,
  addAttributes: function () {
    return { severity: { default: "error" }, message: { default: "" } };
  },
  parseHTML: function () {
    return [{ tag: "span.syntax-hint" }];
  },
  renderHTML: function ({ HTMLAttributes }) {
    return ["span", { ...HTMLAttributes, class: "syntax-hint" }, 0];
  },
  addCommands: function () {
    var name = this.name;
    return {
      addSyntaxHint: function () {
        return function ({ state, commands }) {
          if (state.selection.empty) return false;
          return commands.setMark(name, {});
        };
      },
      clearSyntaxHints: function () {
        return function ({ commands }) {
          return commands.unsetMark(name, { extendEmptyMarkRange: true });
        };
      },
    };
  },
});

/* ------------------------------------------------
 * (2) Inline node: codeEntry (textbox rendered by
 *     NodeView; MUI is not used *inside* NodeView)
 * ------------------------------------------------ */
const CodeEntry = Node.create({
  name: "codeEntry",
  group: "block",             // was "inline"
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes: function () {
    return { original: { default: "" } };
  },

  parseHTML: function () {
    return [{ tag: "div.inline-codebox" }];   // block element
  },

  renderHTML: function ({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, class: "inline-codebox" }]; // no 0 child
  },

  addNodeView: function () {
    function destroyDom(dom: HTMLElement) {
      if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
    }

    function hideBubbleMenu() {
      const el = document.querySelector(".bubble-menu") as HTMLElement | null;
      if (el && !(window as any).__BUBBLE_MENU_HIDDEN) {
        (el as any).__prevDisplay = el.style.display;
        el.style.display = "none";
        (window as any).__BUBBLE_MENU_HIDDEN = true;
      }
    }

    function showBubbleMenuIfHidden() {
      const el = document.querySelector(".bubble-menu") as HTMLElement | null;
      if (el && (window as any).__BUBBLE_MENU_HIDDEN) {
        el.style.display = (el as any).__prevDisplay || "block";
        (window as any).__BUBBLE_MENU_HIDDEN = false;
      }
    }

    return function (props) {
      var node = props.node as PMNode;
      var view = props.editor.view as EditorView;
      var getPos = props.getPos as () => number;

      // Container
      var dom = document.createElement("div");
      dom.className = "inline-codebox";
      dom.setAttribute("contenteditable", "false"); // keep PM from stealing focus

      // Row: [ textarea | Apply | Cancel ]
      var row = document.createElement("div");
      row.className = "inline-codebox-row";

      var textarea = document.createElement("textarea");
      textarea.rows = 2;
      textarea.placeholder = "Further instructions";
      textarea.className = "inline-codebox-textarea";

      var apply = document.createElement("button");
      apply.type = "button";
      apply.textContent = "Apply";
      apply.className = "link-btn";

      var cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      cancel.className = "link-btn";

      row.appendChild(textarea);
      row.appendChild(apply);
      row.appendChild(cancel);
      dom.appendChild(row);

      // Hide BubbleMenu while this box is open
      hideBubbleMenu();

      function replaceOriginalWithText(text: string) {
        var bm = (window as any).__WRITE_BOOKMARK;
        var tr = view.state.tr;

        // Resolve the original selection after all intervening steps
        var from = -1, to = -1;
        try {
          if (bm && typeof bm.map === "function" && typeof bm.resolve === "function") {
            var sel = bm.resolve(view.state.doc);
            from = sel.from; to = sel.to;
          }
        } catch (_) {}

        // Fallback to the naive stored range if bookmark missing
        if (from < 0 || to < 0) {
          var tgt = (window as any).__WRITE_TARGET;
          if (tgt) { from = tgt.from; to = tgt.to; }
        }

        // Replace original selection text if we have a range
        if (from >= 0 && to >= 0) {
          tr.insertText(text, from, to);
        }

        // Delete this NodeView in the same tr (map its position through the tr)
        var nodePos = getPos();
        var mapped = tr.mapping.map(nodePos, 1);
        tr.delete(mapped, mapped + node.nodeSize);

        view.dispatch(tr);

        // Clean up + focus
        (window as any).__WRITE_TARGET = undefined;
        (window as any).__WRITE_BOOKMARK = undefined;
        setTimeout(function(){ view.focus(); }, 0);
      }

      function onApplyClick(this: HTMLButtonElement, _ev: Event) {
        var original = (node.attrs && node.attrs.original) ? String(node.attrs.original) : "";
        var context = textarea.value || "";

        var acts = (window as any).__TextActions as any;
        if (acts && typeof acts.write === "function") {
          acts.write(
            original,
            context,
            function (replacement: string) { replaceOriginalWithText(replacement); },
            { row: (window as any).__CTX_ROW }
          );
        } else {
          replaceOriginalWithText(original);
        }
      }


      function onCancelClick(this: HTMLButtonElement, _ev: Event) {
        var tr = view.state.tr;
        var nodePos = getPos();
        tr.delete(nodePos, nodePos + node.nodeSize);
        view.dispatch(tr);

        (window as any).__WRITE_TARGET = undefined;
        (window as any).__WRITE_BOOKMARK = undefined;
      }


      function onKeydown(this: HTMLTextAreaElement, ev: KeyboardEvent) {
        if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { apply.click(); ev.preventDefault(); }
        else if (ev.key === "Escape") { cancel.click(); ev.preventDefault(); }
      }

      // Keep focus inside: stop PM from handling events in this node
      function stopBubbling(ev: Event) { ev.stopPropagation(); }
      apply.addEventListener("click", onApplyClick);
      cancel.addEventListener("click", onCancelClick);
      textarea.addEventListener("keydown", onKeydown);

      setTimeout(function () { textarea.focus(); }, 0);

      return {
        dom: dom,
        ignoreMutation: function () { return true; },
        stopEvent: function (e: Event) {
          const t = e.target as HTMLElement | null;
          return !!(t && dom.contains(t));
        },
        destroy: function () {
          apply.removeEventListener("click", onApplyClick);
          cancel.removeEventListener("click", onCancelClick);
          textarea.removeEventListener("keydown", onKeydown);
          destroyDom(dom);
          showBubbleMenuIfHidden(); // restore BubbleMenu when box is gone
        },
      };
    };
  },

});



interface TiptapActionsEditorState { busy: boolean; }

export class TiptapActionsEditorMUI extends React.Component<
  TiptapActionsEditorProps,
  TiptapActionsEditorState
> {
  private editor?: Editor;
  private editorRef: React.RefObject<HTMLDivElement>;
  private menuRef: React.RefObject<HTMLDivElement>;

  public constructor(props: TiptapActionsEditorProps) {
    super(props);
    this.editorRef = React.createRef<HTMLDivElement>();
    this.menuRef = React.createRef<HTMLDivElement>();
    this.state = { busy: false };
  }

  private setBusy(b: boolean): void {
    this.setState({ busy: b });
    (window as any).__AI_BUSY = b;
  }

  private hideMenuTemporarily() {
    const menu = this.menuRef.current;
    if (menu) menu.style.display = "none";
    (window as any).__BUBBLE_MENU_HIDDEN = true;
  }

  private showMenuIfWasHidden() {
    const menu = this.menuRef.current;
    if ((window as any).__BUBBLE_MENU_HIDDEN && menu) {
      menu.style.display = "block";
      (window as any).__BUBBLE_MENU_HIDDEN = false;
    }
  }

  public componentDidMount(): void {
    var self = this;

    // Provide row context to actions/NodeViews
    (window as any).__CTX_ROW = this.props.row;

    var menuEl = this.menuRef.current as HTMLDivElement;
    var editorEl = this.editorRef.current as HTMLDivElement;

    // Delegate clicks from the menu container (no JSX handlers)
    function getSelectedText(editor: Editor): string {
      var state = editor.state;
      var sel = state.selection;
      return state.doc.textBetween(sel.from, sel.to, "\n");
    }

    function replaceSelection(editor: Editor, text: string) {
      var tr = editor.state.tr;
      var from = editor.state.selection.from;
      var to = editor.state.selection.to;
      tr.insertText(text, from, to);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection({ from: from, to: from + text.length });
      editor.view.focus();
    }

    function onMenuClick(this: HTMLElement, ev: Event) {
      var target = ev.target as HTMLElement;
      if (!target) return;

      // Ensure we catch clicks on child span inside MUI Button
      var btn = target.closest("button[data-action]") as HTMLButtonElement | null;
      if (!btn) return;

      var action = String(btn.getAttribute("data-action") || "");
      var ed = self.editor as Editor;
      if (!ed || ed.state.selection.empty) return;

      var selected = getSelectedText(ed);

      if (action === "withCode") {
        ed.chain().focus()
          .insertContent({ type: "codeEntry", attrs: { original: selected } })
          .run();
        return;
      }
      self.hideMenuTemporarily();
      var acts = (window as any).__TextActions as TextActionRegistry | undefined;
      function cb(newText: string) { replaceSelection(ed, newText); }

      if (action === "summarize" && acts && (acts as any).summarize) { (acts as any).summarize(selected, null, cb, { row: (window as any).__CTX_ROW }); return; }
      if (action === "proofread" && acts && (acts as any).proofread) { (acts as any).proofread(selected, null, cb, { row: (window as any).__CTX_ROW }); return; }
      if (action === "translate" && acts && (acts as any).translate) { (acts as any).translate(selected, null, cb, { row: (window as any).__CTX_ROW }); return; }
      if (action === "rewrite" && acts && (acts as any).rewrite) { (acts as any).rewrite(selected, null, cb, { row: (window as any).__CTX_ROW }); return; }
      if (action === "write") {
        var sel = ed.state.selection;
        (window as any).__WRITE_TARGET = { from: sel.from, to: sel.to };
        (window as any).__WRITE_BOOKMARK = sel.getBookmark();   // ✅ save a mapping-aware selection

        self.hideMenuTemporarily();

        ed.chain().focus().command(function ({ state, tr, dispatch }) {
          var nodeType = state.schema.nodes.codeEntry;
          if (!nodeType) return false;

          const $from = state.selection.$from;

          // Try to get the enclosing block range
          const range = $from.blockRange();
          let insertPos: number;

          if (range) {
            // position before the block node that contains the selection
            insertPos = range.$from.before(range.depth || 1);
          } else if ($from.depth > 0) {
            insertPos = $from.before($from.depth);
          } else {
            // selection at top level -> insert at start of the doc
            insertPos = 0;
          }

          tr.insert(
            insertPos,
            nodeType.create({ original: state.doc.textBetween(sel.from, sel.to, "\n") })
          );


          if (dispatch) dispatch(tr);
          return true;
        }).run();

        return;
      }



    }

    menuEl.addEventListener("click", onMenuClick);

    // Build the editor
    this.editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit,
        SyntaxHint,
        CodeEntry,
        BubbleMenu.configure({
          element: menuEl,
          tippyOptions: {
            placement: "top",
            animation: "shift-away",
            interactive: true,
            appendTo: () => document.body,
            maxWidth: "none",
          },
          shouldShow: function (ctx) { return !ctx.editor.state.selection.empty; },
        }),

      ],
      content:
        this.props.initialContent || '<p>Hello, enter some text and select the parts you wanna see modified</p>',
      onCreate: function () {
        menuEl.style.display = "block";
      },
      editorProps: {
        attributes: { class: "editor-surface", style: "height:100%;" },
      },
    });

    // Default actions (overridable via props.actions)
    var defaultActions: TextActionRegistry = {
      summarize: function (selectedText, _code, callback, _ctx) {
        self.setBusy(true);
        ai.summarize(selectedText).then(function (s) { callback(s); }).catch(function () { callback(selectedText); }).finally(function () { self.setBusy(false); });
      },
      proofread: function (selectedText, _code, callback, _ctx) {
        self.setBusy(true);
        ai.proofread(selectedText).then(function (s) { callback(s); }).catch(function () { callback(selectedText); }).finally(function () { self.setBusy(false); });
      },
      translate: function (selectedText, _code, callback, _ctx) {
        self.setBusy(true);
        var lang = readLang();
        ai.translate(selectedText, lang).then(function (t) { callback(t); }).catch(function () { callback(selectedText); }).finally(function () { self.setBusy(false); });
      },
      rewrite: function (selectedText, _code, callback, ctx) {
        self.setBusy(true);
        var tone = readRewriterTone();
        const submittedText = `We are working on a contract proposal for the following opportunity:\n${ctx.row.title}\n${ctx.row.description_summary}\n\n` +
        `This is to give you more context while rewriting the following text:\n"""\n${selectedText}\n"""`;
        ai.rewrite(submittedText, tone as RewriterTone, ctx).then(function (t) { callback(t); }).catch(function () { callback(selectedText); }).finally(function () { self.setBusy(false); });
      },
      write: function (selectedText, context, callback, ctx) {
        self.setBusy(true);
        var tone = readWriterTone();
        const submittedText = `We are working on a contract proposal for the following opportunity:\n${ctx.row.title}\n${ctx.row.description_summary}\n\n` +
        `Please draft a ${tone} email to the client based on this opportunity and the additional context provided below starting from the following text:\n${selectedText}\n\nAdditional user specifications:\n${context}`;

        ai.write(submittedText, tone as string, context || "")
          .then(function (t) { callback(t); })
          .catch(function () { callback(selectedText); }).finally(function () { self.setBusy(false); });
      },

    } as any;


    const ai = (window as any).__AI_CLIENT_INSTANCE as AIClient;
    function readWriterTone(): string {
      var el = document.getElementById("ai-writer-tone") as HTMLSelectElement | null;
      return (el && (el.value as WriterTone)) || "proposal";
    }
    function readRewriterTone(): RewriterTone {
      var el = document.getElementById("ai-rewriter-tone") as HTMLSelectElement | null;
      return (el && (el.value as RewriterTone)) || "as-is";
    }
    function readLang(): LangCode {
      var el = document.getElementById("ai-lang") as HTMLSelectElement | null;
      return (el && (el.value as LangCode)) || "en-US";
    }

    (window as any).__TextActions = Object.assign({}, defaultActions, this.props.actions || {});
  }

  public componentWillUnmount(): void {
    if (this.editor) {
      this.editor.destroy();
      this.editor = undefined;
    }
    delete (window as any).__TextActions;
    delete (window as any).__CTX_ROW;
  }

  public markSelectionAsError(): void {
    if (this.editor) this.editor.chain().focus().addSyntaxHint().run();
  }

  public clearAllHints(): void {
    if (this.editor) this.editor.chain().focus().clearSyntaxHints().run();
  }

  public render(): React.ReactNode {
    return (
      <Box className={this.props.className ? this.props.className : ""}>
        {/* Local styles for editor mark + nodeview */}
        <style>{`
          .editor-surface {
            height: calc(100dvh - 200px)!important;
            min-height: 0;
            outline: none;
            width: 100%;
          }
          .syntax-hint { text-decoration: underline wavy; text-decoration-color: #d32f2f; }
          /* block container */
          .inline-codebox {
            display: block;
            padding: 6px 8px;
            margin: 6px 0;
            border: 1px solid rgba(0,0,0,0.23);
            border-radius: 6px;
            background: rgba(0,0,0,0.04);
          }

          /* single-line grid: [ textarea | Apply | Cancel ] */
          .inline-codebox-row {
            display: grid;
            grid-template-columns: 1fr auto auto;
            column-gap: 8px;
            align-items: center;
          }

          .inline-codebox-textarea {
            width: 100%;
            min-height: 2.6em;
            resize: vertical;
            border: 0;
            outline: 0;
            background: transparent;
            font-size: 13px;
          }

          /* link-style buttons */
          .link-btn {
            background: transparent;
            border: 0;
            padding: 0;
            color: #1976d2;
            cursor: pointer;
            text-decoration: none;
          }
          .link-btn:hover { text-decoration: underline; }

        `}</style>

        {/* Bubble menu rendered with MUI components.
            Events are handled via addEventListener (see componentDidMount). */}
        <Box
          ref={this.menuRef}
          className="bubble-menu"
          sx={{
            display: "none",
            p: 0.5,
            bgcolor: "background.paper",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            boxShadow: 1,
            whiteSpace: "nowrap",
            overflowX: "auto",
          }}
        >
          <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1, px: 0.5 }}>
            <Stack direction="row" spacing={0.5} alignItems="center" divider={<Divider orientation="vertical" flexItem />} sx={{ flexWrap: "nowrap" }}>
              {/* Write + tone */}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Button size="small" variant="text" data-action="write">Write</Button>
                <select id="ai-writer-tone" className="bm-select">
                  <option value="proposal">Proposal</option>
                  <option value="reminder">Reminder</option>
                  <option value="change_request">Change Request</option>
                </select>
              </Stack>
              {/* Rewrite + tone */}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Button size="small" variant="text" data-action="rewrite">Rewrite</Button>
                <select id="ai-rewriter-tone" className="bm-select">
                  <option value="more-formal">More Formal</option>
                  <option value="as-is">As is</option>
                  <option value="more-casual">More Casual</option>
                </select>
              </Stack>
              {/* Translate + lang */}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Button size="small" variant="text" data-action="translate">Translate</Button>
                <select id="ai-lang" className="bm-select">
                  <option value="en-US">English</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="fr-FR">Français</option>
                  <option value="es-ES">Español</option>
                  <option value="it-IT">Italiano</option>
                </select>
              </Stack>
              {/* Proofread | Summarize */}
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Button size="small" variant="text" data-action="proofread">Proofread</Button>
                <Button size="small" variant="text" data-action="summarize">Summarize</Button>
              </Stack>
            </Stack>
          </Box>
        </Box>

        {/* Editor chrome in MUI Paper */}
        <Paper sx={{ p:"4px", borderRadius:"4px", width:"99%", border:"1px solid", borderColor:"divider", flex:1, minHeight:0, display:"flex", outline:"none" }}>
        <Box
          ref={this.editorRef}
          sx={{
            height: "calc(100dvh - 200px)",
            overflowY: "auto",
            width: "100%",
          }}
        />
        </Paper>
        <Backdrop
          sx={{ color: "#fff", zIndex: (theme) => theme.zIndex.modal + 2, pointerEvents: "auto" }}
          open={this.state.busy}
        >
          <CircularProgress color="inherit" />
        </Backdrop>

      </Box>
    );
  }
}
