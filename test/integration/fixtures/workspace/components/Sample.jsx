// Used as a plain string, not in class/className — validates literal fallback
const literalOnlyToken = 'literal-only';

export function Sample() {
  return (
    <div className="card-header">
      <span className="title">Hello</span>
      <span className="nonexistent">World</span>
      <button className="btn">Click</button>
    </div>
  );
}

export function Layout() {
  return (
    <div className="wrapper">
      <div className="panel">Panel content</div>
    </div>
  );
}

export function Nav() {
  return (
    <nav className="nav">
      <a className="nav-item">Home</a>
      <a className="nav-item">About</a>
      <a className="nav-item">Contact</a>
    </nav>
  );
}

export function SidebarLayout() {
  return (
    <div>
      <aside className="sidebar">Sidebar</aside>
      <main className="content">Main content</main>
    </div>
  );
}
