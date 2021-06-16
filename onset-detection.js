function onsetDetection(inputReal){
	
	// setting parameters for STFT (parameters used in 'Onset detection revisited', Simon Dixon)
	const windowSize = 2048; 	// [#samples] (46ms)
	const hopSize = 441; 		// [#samples] (10ms, 78.5% overlap)

	var t0 = performance.now()

	var res = STFT(inputReal, windowSize, hopSize);
	var df = createDetectionFunction(res, windowSize);
	var percussiveFeature = percussiveFeatureDetection(res);

	var t1 = performance.now()
	
	document.getElementById("info").innerHTML += "Execution time: " + (t1 - t0) + " ms <br>";
	
	plotData1(inputReal, math.dotDivide(df, math.max(df)), math.divide(percussiveFeature, math.max(percussiveFeature)));	// plotting results with detection functions normalized in range [0,1]
	peakPicking(df);

}

function STFT(inputReal, windowSize, hopSize){

	// input signals with length < windowSize are not analyzed
	// input signals with length = windowSize+(hopSize*x) for x>=0 are fully analyzed
	// input signals with length = windowSize+(hopSize*x)+c for x>=0 and 0<c<hopSize have their last c samples not analyzed

	var res = [];
	var zerosArray = new Array(windowSize).fill(0);
	var i = 0;
	var len = inputReal.length;

	while (i+windowSize <= len){

		// computing in-place FFT
		var outputReal = applyWindow(inputReal.slice(i, i+windowSize), hamming);
		var outputImag = zerosArray.slice();	// inputImag filled with zeros
		transform(outputReal, outputImag);

		// in outputReal Re[-f] =  Re[f] 	(outputReal is symmetric respect to the element at index windowSize/2)
		// in outputImag Im[-f] = -Im[f]
		// using only the positive side of the spectrum makes the detection function sharper and reduces the computational time significantly
		outputReal = outputReal.slice(windowSize/2, windowSize);
		outputImag = outputImag.slice(windowSize/2, windowSize);

		// converting output to polar coordinates
		var outputR = [];
		var outputPhi = [];
		for (var j = 0; j < windowSize/2; j++){
			var complex = math.complex(outputReal[j], outputImag[j]);
		    outputR.push(complex.abs());
		    outputPhi.push(complex.arg());	// phase is in (-pi, pi] range
		}

		res.push([outputR, outputPhi]);
		i += hopSize;
	}

	return res;
}

function createDetectionFunction(s, windowSize){ 

	var targetAmplitudes = [];
	var targetPhases = [];
	var zerosArray = new Array(windowSize/2).fill(0);

	// target amplitude for a frame corresponds to the magnitude of the previous frame
	// target phase for a frame corresponds to the sum of the previous phase and the phase difference between preceding frames

	// target amplitude for the 1st frame is set to 0
	targetAmplitudes.push(zerosArray.slice());
	// target amplitude for the 2nd frame (it's here only to avoid pushing amplitude and phase values in two separate loops)
	targetAmplitudes.push(s[0][0]);

	// target phase for the 1st and the 2nd frame is set to 0
	targetPhases.push(zerosArray.slice());
	targetPhases.push(zerosArray.slice());	

	var len = s.length;
	for (var i = 2; i < len; i++){

		targetAmplitudes.push(s[i-1][0]); 
		targetPhaseValue = math.subtract(math.dotMultiply(2, s[i-1][1]), s[i-2][1]); //targetPhaseValue = math.subtract(s[i-1][1].map(function dotMultiply(item) {return item * 2;}), s[i-2][1]);
		// given a vector x, computing math.atan2(math.sin(x), math.cos(x)) maps the values of x to the range [-pi, pi]
		targetPhases.push(math.atan2(math.sin(targetPhaseValue), math.cos(targetPhaseValue)));
	}

	// constructing the detection function
	var detectionFunction = [];
	for (var i = 0; i < len; i++){

		var stationarityMeasures = [];
		for (var k = 0; k < windowSize/2; k++){

			var targetReIm = math.Complex.fromPolar({r: targetAmplitudes[i][k], phi: targetPhases[i][k]});
			var measuredReIm = math.Complex.fromPolar({r: s[i][0][k], phi: s[i][1][k]});

			// measuring Euclidean distance for the kth bin between target and measured vector in the complex space
			stationarityMeasures.push(math.distance([targetReIm.re, measuredReIm.re], [targetReIm.im, measuredReIm.im]));
		} 
		detectionFunction.push(math.sum(stationarityMeasures));
	}

	return detectionFunction;
}

function percussiveFeatureDetection(s){ 

	let percussiveMeasure = [0]; 	// percussive measure for the first frame is set to 0
	const T = 22;					// threshold (rise in energy [dB] which must be detected to say that the frequency bin is percussive)

	const len = s.length;
	for (let i = 1; i < len; i++)
		percussiveMeasure.push(math.dotMultiply(20, math.log10(math.dotDivide(s[i-1][0],s[i][0]))).filter(x => x > T).length)
	
	return percussiveMeasure;
}

function peakPicking(df){

	// subtracting the mean and dividing by the maximum absolute deviation the detection function
	var mean = math.mean(df);
	// var maxAbsoluteDeviation = math.max(math.abs(math.subtract(arr, math.mean(arr)))); --> nice one-liner but significantly slower than for loop
	var maxAbsoluteDeviation = 0;
	var len = df.length;
	for (var i = 0; i < len; i++){
		if (math.abs(df[i] - mean) > maxAbsoluteDeviation)
			maxAbsoluteDeviation = math.abs(df[i] - mean);
	}
	df = math.divide(math.subtract(df, mean), maxAbsoluteDeviation);

	// low-pass filtering (to do)

	// thresholding df with moving-median 
	// values of delta in 'On the Use of Phase and Energy for Musical Onset Detection in the Complex Domain':
	// delta = 0.34 for np_p, = 4.58 for p_np, = 5.95 for p_p, = 5.79 for cm	
	var delta = 0.1;
	var lambda = 1;		// is set to 1 as it is not critical for the detection
	var m = 20;			// ?come lo imposto? windowSize of the median filter, is set to the longest time interval on which the global dinamics are not expected to evolve (around 100ms)
	
	var threshold = math.add(delta, math.dotMultiply(lambda, movingMedian(df, m)));

	plotData2(df, threshold);	// plot df with threshold
	
	df = math.subtract(df, threshold)	// subtracting threshold from the normalized detection function

	// finding positive peaks of df (local maximums)
	var peaks = [[],[]];
	for (var i = 1; i < len-1; i++){
		if (df[i] >= 0 && df[i-1] < df[i] && df[i] > df[i+1]){
			peaks[0].push(i);		// peak index
			peaks[1].push(df[i]);	// peak value
		}
	}

	plotData3(df, peaks);	// plot df minus threshold with peaks > 0
}