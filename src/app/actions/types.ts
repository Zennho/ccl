/** Return false when the click belongs to another feature. */
export type ClickResult = boolean | Promise<void>;
export type ClickHandler = (target: Element) => ClickResult;
