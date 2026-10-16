'use client';
export default function ErrorPage({ reset }) { return <main className="loading"><h1>Não foi possível abrir a casa.</h1><p>Tente recarregar a página.</p><button className="btn" onClick={reset}>Tentar novamente</button></main>; }
