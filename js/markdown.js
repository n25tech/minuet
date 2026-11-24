/*
 * A small Markdown renderer for note text. Notes are stored as plain text; this only changes how
 * they are shown. Supported: # headings, **bold**, *italic*, ~~strike~~, `code`, ``` code blocks,
 * > quotes, - / 1. lists (nested by indenting), - [ ] task lines, --- rules, [links](https://...)
 * and bare https:// links. Single line breaks are kept, as people type notes line by line.
 *
 * parseMarkdown() is DOM-free and returns a tree of { tag, attrs?, children } nodes and strings;
 * renderMarkdown() turns that into elements with createElement/text nodes only - never innerHTML -
 * so nothing in a note can inject markup. Links are limited to http(s) and mailto.
 */

const MD_SAFE_URL = /^(https?:\/\/|mailto:)/i;

function mdNode(tag, children = [], attrs) {
	return attrs ? { tag, attrs, children } : { tag, children };
}

/* Inline formatting within one block of text. */
function parseInline(text) {
	const out = [];
	let plain = "";
	const flush = () => { if (plain) out.push(plain); plain = ""; };
	let i = 0;
	while (i < text.length) {
		const rest = text.slice(i);
		let match;
		if (text[i] === "\\" && /[\\`*_~\[\]()#>\-+.!]/.test(text[i + 1] || "")) {
			plain += text[i + 1];
			i += 2;
		} else if (text[i] === "\n") {
			flush();
			out.push(mdNode("br"));
			i += 1;
		} else if ((match = /^`([^`\n]+)`/.exec(rest))) {
			flush();
			out.push(mdNode("code", [match[1]]));
			i += match[0].length;
		} else if ((match = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) {
			flush();
			out.push(mdNode("strong", parseInline(match[2])));
			i += match[0].length;
		} else if ((match = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest))) {
			flush();
			out.push(mdNode("del", parseInline(match[1])));
			i += match[0].length;
		} else if ((match = /^\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\*)/.exec(rest))
			|| (/[^\w]|^$/.test(text[i - 1] || "") && (match = /^_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/.exec(rest)))) {
			flush();
			out.push(mdNode("em", parseInline(match[1])));
			i += match[0].length;
		} else if ((match = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(rest)) && MD_SAFE_URL.test(match[2])) {
			flush();
			out.push(mdNode("a", parseInline(match[1]), { href: match[2] }));
			i += match[0].length;
		} else if (/[\s(]|^$/.test(text[i - 1] || "") && (match = /^https?:\/\/[^\s<>"]+[^\s<>".,;:!?)'\]]/.exec(rest))) {
			flush();
			out.push(mdNode("a", [match[0]], { href: match[0] }));
			i += match[0].length;
		} else {
			plain += text[i];
			i += 1;
		}
	}
	flush();
	return out;
}

const MD_LIST_ITEM = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;

/* Block structure: splits lines into headings, lists, quotes, code and paragraphs. */
function parseBlocks(lines) {
	const blocks = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		let match;
		if (!line.trim()) {
			i += 1;
		} else if ((match = /^ {0,3}(```|~~~)/.exec(line))) {
			const fence = match[1];
			const code = [];
			i += 1;
			while (i < lines.length && !lines[i].trimStart().startsWith(fence)) code.push(lines[i++]);
			i += 1;   // the closing fence (or the end of the note)
			blocks.push(mdNode("pre", [mdNode("code", [code.join("\n")])]));
		} else if ((match = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
			blocks.push(mdNode(`h${match[1].length}`, parseInline(match[2])));
			i += 1;
		} else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line)) {
			blocks.push(mdNode("hr"));
			i += 1;
		} else if (/^ {0,3}>/.test(line)) {
			const quoted = [];
			while (i < lines.length && /^ {0,3}>/.test(lines[i])) quoted.push(lines[i++].replace(/^ {0,3}> ?/, ""));
			blocks.push(mdNode("blockquote", parseBlocks(quoted)));
		} else if ((match = MD_LIST_ITEM.exec(line))) {
			const indent = match[1].length;
			const ordered = /\d/.test(match[2]);
			const items = [];
			while (i < lines.length) {
				const item = MD_LIST_ITEM.exec(lines[i]);
				if (!item || item[1].length !== indent || /\d/.test(item[2]) !== ordered) break;
				const body = [item[3]];
				i += 1;
				// Lines indented further than the marker belong to this item (nested lists, wrapped text).
				const leading = text => /^ */.exec(text)[0].length;
				while (i < lines.length && lines[i].trim() && leading(lines[i]) > indent) {
					body.push(lines[i].slice(Math.min(indent + 2, leading(lines[i]))));
					i += 1;
				}
				items.push(listItem(body));
			}
			const attrs = ordered && parseInt(match[2], 10) !== 1 ? { start: String(parseInt(match[2], 10)) } : undefined;
			blocks.push(mdNode(ordered ? "ol" : "ul", items, attrs));
		} else {
			const para = [];
			while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++]);
			if (!para.length) para.push(lines[i++]);
			blocks.push(mdNode("p", parseInline(para.join("\n"))));
		}
	}
	return blocks;
}

function startsBlock(line) {
	return /^ {0,3}(```|~~~|#{1,6}\s|>)/.test(line) || MD_LIST_ITEM.test(line) || /^ {0,3}([-*_])( *\1){2,} *$/.test(line);
}

function listItem(body) {
	const task = /^\[([ xX])\]\s+(.*)$/.exec(body[0]);
	const first = task ? task[2] : body[0];
	// The item's own text stays inline; anything nested below it is parsed as blocks.
	const nestedAt = body.findIndex((line, index) => index > 0 && startsBlock(line));
	const textLines = [first, ...body.slice(1, nestedAt < 0 ? undefined : nestedAt)];
	const children = parseInline(textLines.join("\n"));
	if (nestedAt > 0) children.push(...parseBlocks(body.slice(nestedAt)));
	if (!task) return mdNode("li", children);
	const done = task[1] !== " ";
	return mdNode("li", [mdNode("input", [], { type: "checkbox", checked: done, disabled: true }), ...children], { class: "md-task" + (done ? " done" : "") });
}

function parseMarkdown(text) {
	return parseBlocks(String(text || "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

/* Whether the text uses any Markdown formatting (so plain notes can be shown as they are). */
function hasMarkdown(text) {
	return parseMarkdown(text).some(function formatted(node) {
		if (typeof node === "string") return false;
		return node.tag !== "p" && node.tag !== "br" || node.children.some(formatted);
	});
}

function renderMarkdown(text, doc = document) {
	const build = node => {
		if (typeof node === "string") return doc.createTextNode(node);
		const element = doc.createElement(node.tag);
		for (const [key, value] of Object.entries(node.attrs || {})) {
			if (key === "checked" || key === "disabled") element[key] = value;
			else element.setAttribute(key, value);
		}
		if (node.tag === "a") {
			element.target = "_blank";
			element.rel = "noopener noreferrer";
		}
		element.append(...node.children.map(build));
		return element;
	};
	const fragment = doc.createDocumentFragment();
	fragment.append(...parseMarkdown(text).map(build));
	return fragment;
}

if (typeof module !== "undefined") module.exports = { parseMarkdown, renderMarkdown, hasMarkdown };
