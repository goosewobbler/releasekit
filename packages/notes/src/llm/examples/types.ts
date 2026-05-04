export interface ExampleEntry {
  leadIn?: string;
  description: string;
  category: string;
  scope?: string;
  breaking?: boolean;
}

export interface Example {
  version: string;
  entries: ExampleEntry[];
}
