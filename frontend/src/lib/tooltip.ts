// One floating tooltip for charts and the 3D stage. Text only (textContent), never HTML strings.
let node: HTMLDivElement | null = null;

function el(): HTMLDivElement {
  if (!node) {
    node = document.createElement("div");
    node.className = "tip";
    node.setAttribute("role", "tooltip");
    document.body.appendChild(node);
  }
  return node;
}

export const tip = {
  show(x: number, y: number, title: string, ...lines: (string | undefined | null)[]) {
    const t = el();
    const strong = document.createElement("strong");
    strong.textContent = title;
    t.replaceChildren(strong, ...lines.filter((l): l is string => !!l).map((l) => {
      const d = document.createElement("div");
      d.textContent = l;
      return d;
    }));
    t.classList.add("on");
    const r = t.getBoundingClientRect();
    const left = Math.min(x + 16, window.innerWidth - r.width - 10);
    const top = y + 18 + r.height > window.innerHeight ? y - r.height - 12 : y + 18;
    t.style.transform = `translate(${Math.max(10, left)}px, ${Math.max(10, top)}px)`;
  },
  hide() {
    node?.classList.remove("on");
  },
};
