export async function loadComponents() {
    const elements = document.querySelectorAll('[data-include]');
    for (let el of elements) {
        const file = el.getAttribute('data-include');
        try {
            const response = await fetch(file);
            if (response.ok) {
                const text = await response.text();
                // Opcionalmente podemos envolverlo temporalmente para extraer los nodos
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = text;

                // Mover todos los hijos del div temporal al lugar del elemento original
                while (tempDiv.firstChild) {
                    el.parentNode.insertBefore(tempDiv.firstChild, el);
                }
                // Remover el elemento <div data-include> que actuaba de contenedor/placeholder
                el.parentNode.removeChild(el);
            } else {
                console.error(`Error al cargar el componente: ${file}`);
            }
        } catch (error) {
            console.error(`Error al cargar ${file}. Es posible que necesites usar un servidor local por problemas de CORS en file://`, error);
            el.innerHTML = `<div style="color:red; margin-bottom: 1rem;">⚠️ Error de CORS: Para cargar los componentes modulares necesitas abrir el archivo index.html usando un servidor local (como la extensión Live Server de VS Code) en lugar del protocolo file:// trựcamente.</div>`;
        }
    }
}
