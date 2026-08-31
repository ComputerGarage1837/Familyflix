export default function fixtureToast(text: string) {
    const status = document.querySelector<HTMLElement>('#status');
    if (status) status.textContent = `Nonblocking notice: ${text}`;
}
