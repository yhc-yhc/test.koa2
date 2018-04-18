const ffi = require('ffi')
const ref = require('ref')
const fs = require('fs')
const StructType = require('ref-struct')
const ArcSoftFD = require('./ArcSoftFD.js')
const ArcSoftFR = require('./ArcSoftFR.js')
const ArcSoftBase = require('./ArcSoftBase.js')
const Jimp = require("jimp")
const fse = require('fs-extra')
const base = require('./ArcSoftBase.js')

let APPID = '5Q3UUrYv2T1qAXtsdGFJXaTMjHdgvUpiktzxLhZLcYC1'
let FD_SDKKEY = 'DcHzisteEJPMcDM9ZtPkRGbuvA9FJRUuqvaQNjCBucer'
let FR_SDKKEY = 'DcHzisteEJPMcDM9ZtPkRGc35ZQS8XUwaVtYQ4mCuyT6'

//init Engine
let MAX_FACE_NUM = 50
let FD_WORKBUF_SIZE = 20 * 1024 * 1024
let FR_WORKBUF_SIZE = 40 * 1024 * 1024
const pFDWorkMem = ArcSoftBase.malloc(FD_WORKBUF_SIZE)
const pFRWorkMem = ArcSoftBase.malloc(FR_WORKBUF_SIZE)

const AFR_FSDK_FACEMODEL = StructType({
	pbFeature: base.MHandleType,
	lFeatureSize: base.MInt32
})

const phFDEngine = ref.ref(new Buffer(ArcSoftBase.MIntPtr_t.size))
let ret = ArcSoftFD.AFD_FSDK_InitialFaceEngine(APPID, FD_SDKKEY, pFDWorkMem, FD_WORKBUF_SIZE, phFDEngine, ArcSoftFD.OrientPriority.AFD_FSDK_OPF_0_HIGHER_EXT, 32, MAX_FACE_NUM)
if (ret != 0) {
	ArcSoftBase.free(pFDWorkMem)
	ArcSoftBase.free(pFRWorkMem)
	console.log('AFD_FSDK_InitialFaceEngine ret == ' + ret)
	process.exit()
}
const hFDEngine = ref.deref(phFDEngine)
	//print FD Engine version
const pVersionFD = ArcSoftFD.AFD_FSDK_GetVersion(hFDEngine)
const versionFD = pVersionFD.deref()
console.log('' + versionFD.lCodebase + ' ' + versionFD.lMajor + ' ' + versionFD.lMinor + ' ' + versionFD.lBuild)
console.log(versionFD.Version)
console.log(versionFD.BuildDate)
console.log(versionFD.CopyRight)

const phFREngine = ref.ref(new Buffer(ArcSoftBase.MIntPtr_t.size))
ret = ArcSoftFR.AFR_FSDK_InitialEngine(APPID, FR_SDKKEY, pFRWorkMem, FR_WORKBUF_SIZE, phFREngine)
if (ret != 0) {
	ArcSoftFD.AFD_FSDK_UninitialFaceEngine(hFDEngine)
	ArcSoftBase.free(pFDWorkMem)
	ArcSoftBase.free(pFRWorkMem)
	console.log('AFR_FSDK_InitialEngine ret == ' + ret)
	System.exit(0)
}
const hFREngine = ref.deref(phFREngine)

//print FR Engine version
const pVersionFR = ArcSoftFR.AFR_FSDK_GetVersion(hFREngine)
const versionFR = pVersionFR.deref()
console.log('' + versionFR.lCodebase + ' ' + versionFR.lMajor + ' ' + versionFR.lMinor + ' ' + versionFR.lBuild)
console.log(versionFR.Version)
console.log(versionFR.BuildDate)
console.log(versionFR.CopyRight)

const face2m = {}
const featureMap = {}
let scoreLine = 0.667

async function process(src) {
	const obj = {}
	try {
		const imgMat = await Jimp.read(src)
		const {
			asvl,
			faces
		} = await getFaces(imgMat)

		for (let i = 0; i < faces.nFace; i++) {
			const img = await imgMat.clone()
			const feature = await getFaceFeature(asvl, faces.info[i])
			if (!feature) continue
			let key = `${src.replace(/\//g, '-')}_${i}`
			var faceFeature = new AFR_FSDK_FACEMODEL()
			var buffer = new Buffer(feature, 'base64')
			faceFeature.lFeatureSize = buffer.length
			faceFeature.pbFeature = buffer
			let keyAry = await searchFeature(faceFeature)
			if (!keyAry[0]) {
				face2m[key] = faceFeature
				featureMap[key] = feature
				await fse.ensureDir(`/data/website/faces/`)
				await img.crop(faces.info[i].left, faces.info[i].top, faces.info[i].right - faces.info[i].left, faces.info[i].bottom - faces.info[i].top)
					.write(`/data/website/faces/${key}.jpg`)
			}
			obj[key] = keyAry[0]
		}
	} catch (e) {
		console.log(e)
	}
	return obj
}

async function loadFaceToMap(name, feature) {
	var faceFeature = new AFR_FSDK_FACEMODEL()
	var buffer = new Buffer(feature, 'base64')
	faceFeature.lFeatureSize = buffer.length
	faceFeature.pbFeature = buffer
	face2m[name] = faceFeature
}

async function getFaces(imgMat) {
	return new Promise(async(resolve, reject) => {
		doFaceDetection(imgMat, async function(err, asvl, faces) {
			if (err) {
				reject(err)
			} else {
				resolve({
					asvl,
					faces
				})
			}
		})
	})
}

async function getFaceFeature(asvl, face) {
	return ArcSoftFR.extractFeature(hFREngine, asvl, face)
}


async function searchFeature(feature) {
	const ary = []
	const obj = {}
	for (let fk in face2m) {
		obj[fk] = ArcSoftFR.compareFaceSimilarity(hFREngine, feature, face2m[fk])
	}
	const rs = await Promise.props(obj)
	for (let k in rs) {
		if (rs[k] > scoreLine) {
			ary.push(k)
		}
	}
	return ary
}

async function searchSameFace(src) {
	try {
		const imgMat = await Jimp.read(src)
		const {
			asvl,
			faces
		} = await getFaces(imgMat)
		if (!faces.nFace) {
			log('cant find face: ', src)
			return 0
		}
		const feature = await getFaceFeature(asvl, faces.info[0])
		if (!feature) return 0

		var faceFeature = new AFR_FSDK_FACEMODEL()
		var buffer = new Buffer(feature, 'base64')
		faceFeature.lFeatureSize = buffer.length
		faceFeature.pbFeature = buffer
		return searchFeature(faceFeature)
	} catch (e) {
		return 0
	}

}

function doFaceDetection(img, faces_callback, width, height, format) {

	if (arguments.length === 2) {
		ArcSoftBase.loadImage(img, function(err, inputImage) {
			if (err) throw err
			ArcSoftFD.process(hFDEngine, inputImage, faces_callback)
		})
	} else if (arguments.length === 5) {
		ArcSoftBase.loadYUVImage(img, width, height, format, (err, inputImage) => {
			if (err) throw err
			ArcSoftFD.process(hFDEngine, inputImage, faces_callback)
		})

	} else {
		throw new Error('wrong number of arguments')
	}
}

exports.matchFile = async(path, faceId) => {
	try {
		const imgMat = await Jimp.read(path)
		const {
			asvl,
			faces
		} = await getFaces(imgMat)
		if (!faces.nFace) {
			log('cant find face: ', path)
			return 0
		}

		const featureP = getFaceFeature(asvl, faces.info[0])
		const faceP = model.face.findOne({
			_id: faceId
		}, {
			feature: 1
		})

		const [featureBuf, face] = await Promise.all([featureP, faceP])
		if (!featureBuf.lenth || !face) return 0
		const faceFeature = new AFR_FSDK_FACEMODEL()
		faceFeature.lFeatureSize = featureBuf.length
		faceFeature.pbFeature = featureBuf

		const featureM = face.feature
		const faceFeatureM = new AFR_FSDK_FACEMODEL()
		const bufferM = new Buffer(featureM, 'base64')
		faceFeatureM.lFeatureSize = bufferM.length
		faceFeatureM.pbFeature = bufferM
		const source = await ArcSoftFR.compareFaceSimilarity(hFREngine, faceFeature, faceFeatureM)
		return source
	} catch (e) {
		return 0
	}
}

exports.getFeatureBuf = async(path) => {
	try {
		const imgMat = await Jimp.read(path)
		const {
			asvl,
			faces
		} = await getFaces(imgMat)
		if (!faces.nFace) {
			log('cant find face: ', path)
			return null
		}
		return await getFaceFeature(asvl, faces.info[0])
	} catch (e) {
		return null
	}
}

exports.matchFeatureBuf = async(featureBuf, ids) => {
	const faceFeature = new AFR_FSDK_FACEMODEL()
	faceFeature.lFeatureSize = featureBuf.length
	faceFeature.pbFeature = featureBuf
	const promises = []
	for (let id of ids) {
		const promise = compareBufID(faceFeature, id)
		promises.push(promise)
	}
	return await Promise.all(promises)
}

const compareBufID = async(faceFeature, id) => {
	const face = await model.face.find({
		_id: id
	}, {
		feature: 1
	})
	if (!face) return 0
	const featureM = face.feature
	const faceFeatureM = new AFR_FSDK_FACEMODEL()
	const bufferM = new Buffer(featureM, 'base64')
	faceFeatureM.lFeatureSize = bufferM.length
	faceFeatureM.pbFeature = bufferM
	const source = await ArcSoftFR.compareFaceSimilarity(hFREngine, faceFeature, faceFeatureM)
	return {
		id,
		source
	}
}