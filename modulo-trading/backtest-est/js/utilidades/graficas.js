let myChart = null;

export function initChart(canvasId, data, dcaTimeline = null) {
    const ctx = document.getElementById(canvasId).getContext('2d');

    // Preparar datos (Downsampling si hay muchos datos para que no se trabe)
    const MAX_POINTS = 500;
    let chartData = data;
    let chartTimeline = dcaTimeline;

    if (data.length > MAX_POINTS) {
        const step = Math.ceil(data.length / MAX_POINTS);
        chartData = data.filter((_, index) => index % step === 0);
        if (dcaTimeline) {
            chartTimeline = dcaTimeline.filter((_, index) => index % step === 0);
        }
    }

    const labels = chartData.map(d => {
        if (d.date && typeof d.date.toLocaleDateString === 'function') {
            return d.date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        }
        return String(d.date);
    });

    const prices = chartData.map(d => d.close);

    const datasets = [{
        label: 'Precio Activo (Escala Logarítmica)',
        data: prices,
        borderColor: '#10b981', /* --positive Emerald Green */
        backgroundColor: 'rgba(16, 185, 129, 0.05)',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.1,
        yAxisID: 'y'
    }];

    if (chartTimeline) {
        const dcaValues = chartTimeline.map(t => t.value);
        datasets.push({
            label: 'Valor Portafolio DCA (MXN)',
            data: dcaValues,
            borderColor: '#3b82f6', /* --accent Vibrant Blue */
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            yAxisID: 'y1'
        });
    }

    // Si ya existe borralo
    if (myChart) {
        myChart.destroy();
    }

    myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#e6edf3'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(22, 26, 43, 0.85)',
                    titleColor: '#f8fafc',
                    bodyColor: '#f8fafc',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            // Formato de moneda para el tooltip
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        borderColor: 'transparent'
                    },
                    ticks: {
                        color: '#94a3b8',
                        maxTicksLimit: 10
                    }
                },
                y: {
                    type: 'logarithmic',
                    position: 'left',
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        borderColor: 'transparent'
                    },
                    ticks: {
                        color: '#10b981', // Mismo color verde
                        callback: function (value) {
                            if (value === 10 || value === 100 || value === 1000 || value === 10000 || value === 100000 || value === 1000000) {
                                return '$' + value;
                            }
                            return '';
                        }
                    }
                },
                y1: {
                    type: 'logarithmic',
                    position: 'right',
                    display: chartTimeline ? true : false,
                    grid: {
                        drawOnChartArea: false, // No empalmar grids
                    },
                    ticks: {
                        color: '#3b82f6', // Azul acento
                        callback: function (value) {
                            if (value === 10 || value === 100 || value === 1000 || value === 10000 || value === 100000 || value === 1000000) {
                                return '$' + value;
                            }
                            return '';
                        }
                    }
                }
            }
        }
    });

    return myChart;
}
