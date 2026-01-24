/**
 * js/components/Icons.js - Componentes de iconos SVG
 * Las funciones se definen directamente en el objeto global para evitar
 * conflictos con redeclaraciones en scripts Babel.
 */

// Crear namespaces globales
window.FTI_IconBase = function ({ children, size = 20, className = "", ...props }) {
    return React.createElement('svg', {
        xmlns: "http://www.w3.org/2000/svg",
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        className: className,
        ...props
    }, children);
};

window.FTI_Icons = {
    Upload: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }),
        React.createElement('polyline', { points: "17 8 12 3 7 8" }),
        React.createElement('line', { x1: "12", x2: "12", y1: "3", y2: "15" })
    ),
    Play: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polygon', { points: "5 3 19 12 5 21 5 3" })
    ),
    AlertCircle: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('circle', { cx: "12", cy: "12", r: "10" }),
        React.createElement('line', { x1: "12", x2: "12", y1: "8", y2: "12" }),
        React.createElement('line', { x1: "12", x2: "12.01", y1: "16", y2: "16" })
    ),
    CheckCircle: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M22 11.08V12a10 10 0 1 1-5.93-9.14" }),
        React.createElement('polyline', { points: "22 4 12 14.01 9 11.01" })
    ),
    Activity: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "22 12 18 12 15 21 9 3 6 12 2 12" })
    ),
    Sun: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('circle', { cx: "12", cy: "12", r: "5" }),
        React.createElement('line', { x1: "12", y1: "1", x2: "12", y2: "3" }),
        React.createElement('line', { x1: "12", y1: "21", x2: "12", y2: "23" }),
        React.createElement('line', { x1: "4.22", y1: "4.22", x2: "5.64", y2: "5.64" }),
        React.createElement('line', { x1: "18.36", y1: "18.36", x2: "19.78", y2: "19.78" }),
        React.createElement('line', { x1: "1", y1: "12", x2: "3", y2: "12" }),
        React.createElement('line', { x1: "21", y1: "12", x2: "23", y2: "12" }),
        React.createElement('line', { x1: "4.22", y1: "19.78", x2: "5.64", y2: "18.36" }),
        React.createElement('line', { x1: "18.36", y1: "5.64", x2: "19.78", y2: "4.22" })
    ),
    AlertTriangle: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" }),
        React.createElement('line', { x1: "12", y1: "9", x2: "12", y2: "13" }),
        React.createElement('line', { x1: "12", y1: "17", x2: "12.01", y2: "17" })
    ),
    Stethoscope: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M6 2v6a6 6 0 0 0 12 0V2" }),
        React.createElement('path', { d: "M8 2v6a4 4 0 0 0 8 0V2" }),
        React.createElement('path', { d: "M12 14v2a4 4 0 0 0 8 0v-1" }),
        React.createElement('circle', { cx: "20", cy: "15", r: "2" })
    ),
    Target: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('circle', { cx: "12", cy: "12", r: "10" }),
        React.createElement('circle', { cx: "12", cy: "12", r: "6" }),
        React.createElement('circle', { cx: "12", cy: "12", r: "2" })
    ),
    ShieldAlert: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M12 22s8-4 8-10V5L12 2 4 5v7c0 6 8 10 8 10" }),
        React.createElement('line', { x1: "12", x2: "12", y1: "8", y2: "12" }),
        React.createElement('line', { x1: "12", x2: "12.01", y1: "16", y2: "16" })
    ),
    ShieldCheck: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M12 22s8-4 8-10V5L12 2 4 5v7c0 6 8 10 8 10" }),
        React.createElement('polyline', { points: "9 12 12 15 15 10" })
    ),
    BarChart3: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M3 3v18h18" }),
        React.createElement('path', { d: "M18 17V9" }),
        React.createElement('path', { d: "M13 17V5" }),
        React.createElement('path', { d: "M8 17v-3" })
    ),
    Clock: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('circle', { cx: "12", cy: "12", r: "10" }),
        React.createElement('polyline', { points: "12 6 12 12 16 14" })
    ),
    TrendingUp: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "23 6 13.5 15.5 8.5 10.5 1 18" }),
        React.createElement('polyline', { points: "17 6 23 6 23 12" })
    ),
    History: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12" }),
        React.createElement('path', { d: "M3 3v9h9" }),
        React.createElement('path', { d: "M12 7v5l3 3" })
    ),
    Lock: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('rect', { x: "3", y: "11", width: "18", height: "11", rx: "2", ry: "2" }),
        React.createElement('path', { d: "M7 11V7a5 5 0 0 1 10 0v4" })
    ),
    Zap: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polygon', { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })
    ),
    FileText: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" }),
        React.createElement('polyline', { points: "14 2 14 8 20 8" })
    ),
    Camera: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" }),
        React.createElement('circle', { cx: "12", cy: "13", r: "4" })
    ),
    HelpCircle: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('circle', { cx: "12", cy: "12", r: "10" }),
        React.createElement('path', { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }),
        React.createElement('line', { x1: "12", x2: "12.01", y1: "17", y2: "17" })
    ),
    Map: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polygon', { points: "3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6" }),
        React.createElement('line', { x1: "9", x2: "9", y1: "3", y2: "18" }),
        React.createElement('line', { x1: "15", x2: "15", y1: "6", y2: "21" })
    ),
    ChevronDown: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "6 9 12 15 18 9" })
    ),
    ChevronLeft: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "15 18 9 12 15 6" })
    ),
    ChevronRight: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "9 18 15 12 9 6" })
    ),
    Trash2: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('polyline', { points: "3 6 5 6 21 6" }),
        React.createElement('path', { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
        React.createElement('line', { x1: "10", y1: "11", x2: "10", y2: "17" }),
        React.createElement('line', { x1: "14", y1: "11", x2: "14", y2: "17" })
    ),
    Split: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M12 3v18" }),
        React.createElement('path', { d: "M4 7h5" }),
        React.createElement('path', { d: "M15 7h5" }),
        React.createElement('path', { d: "M4 17h5" }),
        React.createElement('path', { d: "M15 17h5" }),
        React.createElement('path', { d: "M4 12h16" })
    ),
    Calendar: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('rect', { x: "3", y: "4", width: "18", height: "18", rx: "2", ry: "2" }),
        React.createElement('line', { x1: "16", y1: "2", x2: "16", y2: "6" }),
        React.createElement('line', { x1: "8", y1: "2", x2: "8", y2: "6" }),
        React.createElement('line', { x1: "3", y1: "10", x2: "21", y2: "10" })
    ),
    Edit2: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" })
    ),
    Shield: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M12 22s8-4 8-10V5L12 2 4 5v7c0 6 8 10 8 10" })
    ),
    Eye: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('path', { d: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" }),
        React.createElement('circle', { cx: "12", cy: "12", r: "3" })
    ),
    X: (p) => React.createElement(window.FTI_IconBase, p,
        React.createElement('line', { x1: "18", y1: "6", x2: "6", y2: "18" }),
        React.createElement('line', { x1: "6", y1: "6", x2: "18", y2: "18" })
    )
};
