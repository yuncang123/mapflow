import fs from "node:fs";
import path from "node:path";

export class Notes {
  constructor(file) {
    this.file = file;
    this.items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.items, null, 2)}\n`, "utf8");
  }

  add(text) {
    const note = { id: `note-${this.items.length + 1}`, text, status: "active" };
    this.items.push(note);
    this.save();
    return note;
  }

  list() {
    return this.items.filter((item) => item.status === "active");
  }
}
