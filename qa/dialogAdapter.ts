// Fixture-only seam. The deployed app uses Jellyfin's existing dialog/focus/history helper.
export default {
    createDialog() {
        const dialog = document.createElement('dialog');
        dialog.className = 'dialog hide';
        return dialog;
    },
    open(dialog: HTMLDialogElement) {
        document.body.append(dialog);
        dialog.classList.remove('hide');
        dialog.showModal();
        return Promise.resolve();
    },
    close(dialog: HTMLDialogElement) {
        if (!dialog.open) return;
        dialog.close();
        dialog.classList.add('hide');
        setTimeout(() => dialog.remove(), 0);
    }
};
