module.exports = async function(req, res) {
    const authHeader = req.headers.authorization;
    const pwd = process.env.SYNC_PASSWORD;

    if (!pwd || authHeader !== `Bearer ${pwd}`) {
        return res.status(401).json({ error: 'No autorizado o clave incorrecta' });
    }

    const { module = 'finanzas', part = '', index = '' } = req.query;
    const method = req.method;

    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    const baseFileName = process.env[`FILE_NAME_${module.toUpperCase()}`] || `${module}_backup`;

    if (!repo || !token) {
        return res.status(500).json({ error: 'Configuración del servidor incompleta (GITHUB_REPO o GITHUB_TOKEN faltantes).' });
    }

    // Determinar el nombre del archivo exacto en GitHub
    let targetFileName = '';
    if (index === 'true') {
        targetFileName = `${baseFileName}_index.json`;
    } else if (part !== '') {
        targetFileName = `${baseFileName}_part${part}.json`;
    } else {
        // Fallback por si quieren bajarlo entero en un futuro
        targetFileName = `${baseFileName}.json`;
    }

    const url = `https://api.github.com/repos/${repo}/contents/${targetFileName}`;

    if (method === 'GET') {
        try {
            const getRes = await fetch(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.raw' // Para leer archivos grandes crudos
                }
            });

            if (!getRes.ok) {
                if (getRes.status === 404) {
                    return res.status(200).json({ exists: false, data: null });
                }
                const errText = await getRes.text();
                throw new Error(`Error leyendo de GitHub: ${errText}`);
            }

            // Si es .raw, Github puede retornar el JSON directo o el string crudo
            const rawText = await getRes.text();
            
            // Intentamos parsear si es el index o si es json válido, 
            // sino devolvemos el texto (que es el chunk)
            try {
                const data = JSON.parse(rawText);
                return res.status(200).json({ exists: true, data });
            } catch (e) {
                return res.status(200).json({ exists: true, raw: rawText });
            }

        } catch (error) {
            console.error('Error GET:', error);
            return res.status(500).json({ error: error.message });
        }
    } else if (method === 'POST') {
        try {
            // Recibimos el payload. El chunk crudo puede ser un string muy grande
            const payloadStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
            
            // 1. Obtener el SHA actual para poder sobreescribir el archivo
            let sha = null;
            const checkRes = await fetch(url, {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });

            if (checkRes.ok) {
                const checkData = await checkRes.json();
                sha = checkData.sha;
            }

            // 2. Subir el archivo/chunk
            const body = {
                message: `Backup automático ${targetFileName} - ${new Date().toISOString()}`,
                content: Buffer.from(payloadStr).toString('base64')
            };
            if (sha) body.sha = sha;

            const putRes = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!putRes.ok) {
                const errData = await putRes.json();
                throw new Error(`Error guardando ${targetFileName}: ${errData.message}`);
            }

            return res.status(200).json({ success: true, fileName: targetFileName });
        } catch (error) {
            console.error('Error POST:', error);
            return res.status(500).json({ error: error.message });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: `Método ${method} no permitido` });
    }
};
