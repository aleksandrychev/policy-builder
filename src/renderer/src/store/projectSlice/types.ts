export interface Project {
  description: string;
  // New per created project; remounts the project view.
  id: string;
  // The masterfiles version in the cfbs project, null for none (or not saved yet).
  masterfiles: string | null;
  name: string;
  // The cfbs project folder; null while the project only lives in memory (the demo).
  path: string | null;
}
