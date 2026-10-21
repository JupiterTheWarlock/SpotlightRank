let opened = null;

export class ValueDropdown {
  constructor(root, { label, onChange }) {
    this.root = root;
    this.label = label;
    this.onChange = onChange;
    this.options = [];
    root.classList.add('filter-menu');
    this.trigger = document.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'filter-trigger';
    this.trigger.id = `${root.id}-trigger`;
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', `${root.id}-options`);
    const caption = document.createElement('span');
    caption.className = 'filter-label';
    caption.textContent = label;
    this.valueLabel = document.createElement('strong');
    this.valueLabel.className = 'filter-value';
    const arrow = document.createElement('span');
    arrow.className = 'filter-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '⌄';
    this.trigger.append(caption, this.valueLabel, arrow);
    this.list = document.createElement('div');
    this.list.className = 'filter-options';
    this.list.id = `${root.id}-options`;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', label);
    this.list.hidden = true;
    root.append(this.trigger, this.list);
    this.trigger.addEventListener('click', () => this.list.hidden ? this.open() : this.close());
    this.trigger.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        this.open(event.key === 'ArrowUp');
      }
    });
    this.list.addEventListener('click', event => {
      const option = event.target.closest('[role="option"]');
      if (!option) return;
      this.value = option.dataset.value;
      this.updateSelection();
      this.close(true);
      this.onChange(this.value);
    });
    root.addEventListener('keydown', event => {
      if (this.list.hidden) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.close(true); }
      if (event.key === 'Tab') this.close(true);
      if (!this.list.contains(event.target)) return;
      const buttons = [...this.list.children];
      let index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
      else if (event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault();
      buttons[index]?.focus();
    });
    root.addEventListener('focusout', () => {
      queueMicrotask(() => { if (!root.contains(document.activeElement)) this.close(); });
    });
  }

  setOptions(options, value, disabled = false) {
    this.close();
    this.options = options;
    this.value = options.some(option => option.value === String(value)) ? String(value) : options[0]?.value;
    this.trigger.disabled = disabled;
    this.list.replaceChildren(...options.map(option => {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.className = 'filter-option';
      button.dataset.value = option.value;
      button.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = option.label;
      button.append(label);
      if (option.count !== undefined) {
        const count = document.createElement('small');
        count.textContent = option.count.toLocaleString('zh-CN');
        count.title = '全部已收录作品中符合这一项的数量';
        button.append(count);
      }
      return button;
    }));
    this.updateSelection();
  }

  updateSelection() {
    const selected = this.options.find(option => option.value === this.value);
    this.valueLabel.textContent = selected?.label || '全部';
    this.trigger.title = `${this.label}：${this.valueLabel.textContent}`;
    this.root.classList.toggle('is-filtered', this.value !== this.options[0]?.value);
    for (const button of this.list.children) button.setAttribute('aria-selected', String(button.dataset.value === this.value));
  }

  open(last = false) {
    if (this.trigger.disabled || !this.options.length) return;
    if (opened && opened !== this) opened.close();
    opened = this;
    const bounds = this.root.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const upwards = below < 180 && above > below;
    this.root.classList.toggle('opens-up', upwards);
    this.list.style.maxHeight = `${Math.min(280, Math.max(100, upwards ? above : below))}px`;
    this.list.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    const selected = this.list.querySelector('[aria-selected="true"]');
    (last ? this.list.lastElementChild : selected || this.list.firstElementChild)?.focus({ preventScroll: true });
    const focused = last ? this.list.lastElementChild : selected;
    if (focused) this.list.scrollTop = Math.max(0, focused.offsetTop - this.list.clientHeight / 2);
  }

  close(restoreFocus = false) {
    this.list.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    if (opened === this) opened = null;
    if (restoreFocus) this.trigger.focus({ preventScroll: true });
  }
}

document.addEventListener('pointerdown', event => {
  if (opened && !opened.root.contains(event.target)) opened.close();
});
