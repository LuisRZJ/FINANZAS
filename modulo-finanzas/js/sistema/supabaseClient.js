// Cliente de Supabase
// Configurado con las credenciales del proyecto GTR-Finanzas

const SUPABASE_URL = 'https://rfuacwoyodmiqhagktyl.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJmdWFjd295b2RtaXFoYWdrdHlsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgyNTI1OTUsImV4cCI6MjA4MzgyODU5NX0.q4SG9Mp53rAfG5RV4cnXOkqX6yboWUj756D6lkV7xFo'

// Esperar a que la librería de Supabase cargue
let supabaseClient = null

function getSupabase() {
  if (!supabaseClient && window.supabase) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  }
  return supabaseClient
}

export { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY }
