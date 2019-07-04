(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// Process figures
'use strict';

//#region Renderer partials

function render_figure_id(tokens, idx, options, env/*, slf*/) {
  var n = Number(tokens[idx].meta.id).toString();
  return n;
}

function render_figure_ref(tokens, idx, options, env, slf) {
  var id = slf.rules.figure_id(tokens, idx, options, env.slf);

  var label = tokens[idx].meta.label;
  var number = tokens[idx].meta.number;

  var link = `<a href="#fig${id}" class="figure-ref">${label} ${number}</a>`;
  return link;
}

function render_figure_open(tokens, idx, options, env, slf) {
  var id = slf.rules.figure_id(tokens, idx, options, env, slf);

  return `<figure id="fig${id}">\n`;
}

function render_figure_caption(tokens, idx, options, env, slf) {
  var captionParts = [];

  if (tokens[idx].meta.number) {
    captionParts.push(`Figure ${tokens[idx].meta.number}`);
  }

  if (tokens[idx].meta.caption) {
    captionParts.push(tokens[idx].meta.caption);
  }

  return captionParts.length
    ? `<figcaption>${captionParts.join(': ')}</figcaption>\n`
    : '';
}

function render_figure_close(tokens, idx, options, env, slf) {
  var caption = slf.rules.figure_caption(tokens, idx, options, env, slf);

  return `${caption}</figure>\n`;
}

//#endregion Renderer partials

module.exports = function figure_plugin(md, options) {

  options = options || {};

  var min_markers = 3,
    marker_str = options.marker || '+',
    marker_char = marker_str.charCodeAt(0),
    marker_len = marker_str.length;

  function figure(state, startLine, endLine, silent) {
    var pos, nextLine, marker_count, markup, params, token,
      old_parent, old_line_max,
      auto_closed = false,
      start = state.bMarks[startLine] + state.tShift[startLine],
      max = state.eMarks[startLine],
      figureId, meta;

    // Check out the first character quickly,
    // this should filter out most of non-figures
    if (marker_char !== state.src.charCodeAt(start)) { return false; }

    // Check out the rest of the marker string
    for (pos = start + 1; pos <= max; pos++) {
      if (marker_str[(pos - start) % marker_len] !== state.src[pos]) {
        break;
      }
    }

    // Count the number of markers. If there aren't enough, it's not a figure.
    marker_count = Math.floor((pos - start) / marker_len);
    if (marker_count < min_markers) { return false; }
    pos -= (pos - start) % marker_len;

    markup = state.src.slice(start, pos);
    params = state.src.slice(pos, max);

    // Since start is found, we can report success here in validation mode
    if (silent) { return true; }

    // Search for the end of the block
    nextLine = startLine;

    for (; ;) {
      nextLine++;
      if (nextLine >= endLine) {
        // Unclosed block should be autoclosed by end of document.
        // also block seems to be autoclosed by end of parent
        break;
      }

      start = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (start < max && state.sCount[nextLine] < state.blkIndent) {
        // Non-empty line with negative indent should stop the list:
        // - ```
        //  test
        break;
      }

      if (marker_char !== state.src.charCodeAt(start)) { continue; }

      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        // Closing fence should be indented less than 4 spaces
        continue;
      }

      for (pos = start + 1; pos <= max; pos++) {
        if (marker_str[(pos - start) % marker_len] !== state.src[pos]) {
          break;
        }
      }

      // Closing fence must be at least as long as the opening one
      if (Math.floor((pos - start) / marker_len) < marker_count) { continue; }

      // Make sure tail has spaces only
      pos -= (pos - start) % marker_len;
      pos = state.skipSpaces(pos);
      if (pos < max) { continue; }

      // Found!
      auto_closed = true;
      break;
    }

    if (!state.env.figures) { state.env.figures = {}; }
    if (!state.env.figures.list) { state.env.figures.list = []; }
    if (isNaN(state.env.figures.current)) { state.env.figures.current = 0; }
    if (isNaN(state.env.figures.number)) { state.env.figures.number = 0; }

    figureId = state.env.figures.current += 1;
    
    var ref, caption, numbered, number;
    var refMatch = params.match(/^\s*(?<numbered>(?<ref>[a-z0-9_-]*)\s*:)?\s*(?<caption>.*)\s*$/i);
    if (refMatch) {
      ref = refMatch.groups.ref;
      caption = refMatch.groups.caption;
      numbered = !!refMatch.groups.numbered;
    }

    if (numbered) {
      number = state.env.figures.number += 1;
    }

    meta = {
      id: figureId,
      ref,
      caption,
      numbered,
      number,
    };

    state.env.figures.list[ref] = meta;

    old_parent = state.parentType;
    old_line_max = state.lineMax;
    state.parentType = 'figure';

    // This will prevent lazy continuations from ever going past our end marker
    state.lineMax = nextLine;

    token = state.push('figure_open', 'figure', 1);
    token.markup = markup;
    token.block = true;
    token.map = [startLine, nextLine];
    token.meta = meta;

    state.md.block.tokenize(state, startLine + 1, nextLine);

    token = state.push('figure_close', 'figure', -1);
    token.markup = state.src.slice(start, pos);
    token.block = true;
    token.meta = meta;

    state.parentType = old_parent;
    state.lineMax = old_line_max;
    state.line = nextLine + (auto_closed ? 1 : 0);

    return true;
  }

  // Process figure references (+[figure x])
  function figure_ref(state, silent) {
    var tag, label, ref,
      type,
      pos,
      // annotationId,
      // annotationSubId,
      token,
      max = state.posMax,
      start = state.pos;

    // Should be at least 4 chars - "+[x]"
    if (start + 3 > max) { return false; }

    // No figures found
    if (!state.env.figures || !state.env.figures.list) { return false; }

    if (state.src.charCodeAt(start) !== 0x2B/* + */) { return false; }
    if (state.src.charCodeAt(start + 1) !== 0x5B/* [ */) { return false; }

    for (pos = start + 2; pos < max; pos++) {
      if (state.src.charCodeAt(pos) === 0x0A/* \n */) { return false; }
      if (state.src.charCodeAt(pos) === 0x5D/* ] */) {
        break;
      }
    }

    if (pos === start + 2) { return false; } // no empty annotation labels
    if (pos >= max) { return false; } // end of block reached
    pos++;

    // Extract the label and ref from the tag.
    tag = state.src.slice(start + 2, pos - 1);
    label = tag.substring(0, tag.lastIndexOf(' '));
    ref = tag.substring(tag.lastIndexOf(' ') + 1);

    if (typeof state.env.figures.list[ref] === 'undefined') { return false; }

    if (!silent) {
      var figure = state.env.figures.list[ref];

      token = state.push('figure_ref', '', 0);
      token.meta = { label, ...figure };
    }

    state.pos = pos;
    state.posMax = max;
    return true;
  }

  md.block.ruler.before('fence', 'figure', figure, {
    alt: ['paragraph']
  });
  md.inline.ruler.after('image', 'figure_ref', figure_ref);

  md.renderer.rules.figure_id = render_figure_id;
  md.renderer.rules.figure_ref = render_figure_ref;
  md.renderer.rules.figure_open = render_figure_open;
  md.renderer.rules.figure_caption = render_figure_caption;
  md.renderer.rules.figure_close = render_figure_close;
};

},{}]},{},[1]);
