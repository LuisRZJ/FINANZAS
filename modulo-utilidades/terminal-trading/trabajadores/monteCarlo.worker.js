self.onmessage = function(e) {
    const { trades, simCount, riskPercent } = e.data;
    
    // Fisher-Yates shuffle
    function shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    const drawdowns = [];
    const finalEquities = [];
    const sampleCurves = [];
    let ruinCount = 0;
    const ruinThreshold = -50; // 50% drawdown = ruin

    for (let sim = 0; sim < simCount; sim++) {
        const shuffled = shuffle(trades);
        let currentEquity = 100;
        let peak = 100;
        let maxDrawdown = 0;
        const curve = sim < 50 ? [100] : null; // Store first 50 curves for visualization
        
        for (let t = 0; t < shuffled.length; t++) {
            const amount = currentEquity * riskPercent * shuffled[t];
            currentEquity += amount;
            if (curve) curve.push(currentEquity);
            
            if (currentEquity > peak) peak = currentEquity;
            const dd = ((currentEquity - peak) / peak) * 100;
            if (dd < maxDrawdown) maxDrawdown = dd;
            
            // Check for ruin
            if (currentEquity <= 50) {
                ruinCount++;
                break;
            }
        }
        
        drawdowns.push(maxDrawdown);
        finalEquities.push(currentEquity);
        if (curve) sampleCurves.push(curve);
    }

    // Sort for percentiles
    drawdowns.sort((a, b) => a - b);
    finalEquities.sort((a, b) => a - b);

    const percentile = (arr, p) => {
        const idx = Math.floor(arr.length * p);
        return arr[Math.min(idx, arr.length - 1)];
    };

    const result = {
        worstDrawdown: drawdowns[0],
        avgDrawdown: drawdowns.reduce((a, b) => a + b, 0) / drawdowns.length,
        ruinProbability: (ruinCount / simCount) * 100,
        percentiles: {
            p5: percentile(drawdowns, 0.05),
            p25: percentile(drawdowns, 0.25),
            p50: percentile(drawdowns, 0.50),
            p75: percentile(drawdowns, 0.75),
            p95: percentile(drawdowns, 0.95)
        },
        equityPercentiles: {
            p5: percentile(finalEquities, 0.05),
            p25: percentile(finalEquities, 0.25),
            p50: percentile(finalEquities, 0.50),
            p75: percentile(finalEquities, 0.75),
            p95: percentile(finalEquities, 0.95)
        },
        sampleCurves: sampleCurves.slice(0, 20), // Only send 20 for visualization
        simCount
    };

    self.postMessage(result);
};
