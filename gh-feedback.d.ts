/**
 * Type definitions for <gh-feedback> Web Component.
 *
 * @see https://github.com/zeveck/gh-feedback
 */

export type FeedbackType = 'bug' | 'feature' | 'question' | 'ui' | 'docs' | 'performance';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type TriggerStyle = 'fab' | 'button' | 'link' | 'none';
export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type Theme = 'light' | 'dark';
export type IconName = 'chat' | 'bug' | 'megaphone' | 'lightbulb' | 'pencil' | 'flag' | 'memo' | 'none';
export type Size = 'sm' | 'md' | 'lg' | (string & {});

export interface SubmitDetail {
  title: string;
  type: FeedbackType;
  description: string;
  labels: string[];
  repo: string;
  severity?: Severity;
}

export interface FiledDetail {
  issueNumber: number;
  issueUrl: string;
}

export interface ErrorDetail {
  error: string;
}

export interface GhFeedbackEventMap {
  'gh-feedback:submit': CustomEvent<SubmitDetail>;
  'gh-feedback:filed': CustomEvent<FiledDetail>;
  'gh-feedback:error': CustomEvent<ErrorDetail>;
}

export declare class GhFeedback extends HTMLElement {
  static readonly observedAttributes: string[];

  /** GitHub token set via JS property (avoids DOM exposure). */
  token: string | null;

  /**
   * Optional callback that returns key-value context to attach to the filed issue.
   * Called at submission time. Errors in the callback are silently ignored.
   */
  getContext: (() => Record<string, string | number | boolean>) | null;

  /** Open the feedback popup programmatically. */
  open(): void;

  /** Close the feedback popup programmatically. */
  close(): void;

  /** Toggle the feedback popup open/closed. */
  toggle(): void;

  addEventListener<K extends keyof GhFeedbackEventMap>(
    type: K,
    listener: (this: GhFeedback, ev: GhFeedbackEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;

  removeEventListener<K extends keyof GhFeedbackEventMap>(
    type: K,
    listener: (this: GhFeedback, ev: GhFeedbackEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'gh-feedback': GhFeedback;
  }
}
