// Servicio de Autenticación con Supabase
import { getSupabase } from '../sistema/supabaseClient.js'

/**
 * Registrar un nuevo usuario
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: string|null}>}
 */
export async function registrar(email, password) {
    const supabase = getSupabase()
    if (!supabase) {
        return { user: null, error: 'Supabase no está disponible' }
    }

    const { data, error } = await supabase.auth.signUp({
        email,
        password
    })

    if (error) {
        return { user: null, error: error.message }
    }

    return { user: data.user, error: null }
}

/**
 * Iniciar sesión
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{user: object|null, error: string|null}>}
 */
export async function iniciarSesion(email, password) {
    const supabase = getSupabase()
    if (!supabase) {
        return { user: null, error: 'Supabase no está disponible' }
    }

    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    })

    if (error) {
        return { user: null, error: error.message }
    }

    return { user: data.user, error: null }
}

/**
 * Cerrar sesión
 * @returns {Promise<{error: string|null}>}
 */
export async function cerrarSesion() {
    const supabase = getSupabase()
    if (!supabase) {
        return { error: 'Supabase no está disponible' }
    }

    const { error } = await supabase.auth.signOut()

    if (error) {
        return { error: error.message }
    }

    return { error: null }
}

/**
 * Obtener el usuario actual
 * @returns {Promise<object|null>}
 */
export async function obtenerUsuarioActual() {
    const supabase = getSupabase()
    if (!supabase) {
        return null
    }

    const { data: { user } } = await supabase.auth.getUser()
    return user
}

/**
 * Escuchar cambios en el estado de autenticación
 * @param {function} callback - Función que recibe (event, session)
 * @returns {object} - Subscription para poder desuscribirse
 */
export function onAuthStateChange(callback) {
    const supabase = getSupabase()
    if (!supabase) {
        return { data: { subscription: { unsubscribe: () => { } } } }
    }

    return supabase.auth.onAuthStateChange(callback)
}
