import { Pipe, PipeTransform } from '@angular/core';
import { Marked } from 'marked';

const markdown = new Marked({ gfm: true, breaks: true });

/**
 * Renders model text as HTML. Always bind the result through [innerHTML],
 * so Angular's sanitizer strips scripts and event handlers.
 */
@Pipe({ name: 'md', standalone: true })
export class MarkdownPipe implements PipeTransform {
  transform(value: unknown, mode: 'block' | 'inline' = 'block'): string {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return (mode === 'inline' ? markdown.parseInline(text) : markdown.parse(text)) as string;
  }
}
