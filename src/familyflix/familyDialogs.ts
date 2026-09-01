import dialogHelper from 'components/dialogHelper/dialogHelper';
import 'elements/emby-select/emby-select';
import { onFamilySessionChange, type FamilySession } from './familySession';
import './familyTools.scss';

export function familyButton(label: string, click: () => void, className = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emby-button raised show-focus ' + className;
    button.textContent = label;
    button.addEventListener('click', click);
    return button;
}

export function setFamilyButtonDisabled(button: HTMLButtonElement, disabled: boolean): void {
    button.disabled = disabled;
    button.setAttribute('aria-disabled', String(disabled));
}

export function familySelect(label: string): { container: HTMLDivElement; select: HTMLSelectElement } {
    const container = document.createElement('div');
    container.className = 'selectContainer';
    container.innerHTML = '<select is="emby-select"></select>';
    const select = container.querySelector('select')!;
    select.setAttribute('label', label);
    return { container, select };
}

export function familyTextarea(): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    textarea.className = 'emby-textarea';
    return textarea;
}

export function familyParagraph(text: string, className = ''): HTMLParagraphElement {
    const paragraph = document.createElement('p');
    paragraph.className = className;
    paragraph.textContent = text;
    return paragraph;
}

/** The established helper owns history/Back and the modal focus scope. */
export function familyDialog(title: string, session: FamilySession, origin?: HTMLElement, onClose?: () => void) {
    const dialog = dialogHelper.createDialog({ removeOnClose: true, scrollY: true }) as HTMLElement;
    dialog.classList.add('familyDialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', title);
    const heading = document.createElement('h2');
    heading.textContent = title;
    const content = document.createElement('div');
    content.className = 'familyDialogContent';
    const status = familyParagraph('');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    actions.className = 'familyDialogActions';
    dialog.append(heading, content, status, actions);
    let closed = false;
    const close = () => {
        if (closed) return;
        dialogHelper.close(dialog);
    };
    const unsubscribe = onFamilySessionChange(() => {
        if (!session.current()) close();
    });
    dialog.addEventListener('close', () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        // Remove sensitive admin content immediately, including cached/hidden dialogs.
        content.replaceChildren();
        onClose?.();
        if (session.current() && origin?.isConnected && (!document.activeElement || document.activeElement === document.body)) origin.focus();
    }, { once: true });
    dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    });
    return {
        dialog, content, status, actions, close,
        current: () => !closed && session.current(),
        open: () => { void dialogHelper.open(dialog); }
    };
}
