import http from "node:http";
import crypto from "node:crypto";

const PORT = 3000;
const WEBSOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SEVEN_BITS_INTEGER_MARKER = 125;
const SIXTEEN_BITS_INTEGER_MARKER = 126;
const SIXTY_FOUR_BITS_INTEGER_MARKER = 127;
const MASK_KEY_BYTES_LENGTH = 4;
const OPCODE_TEXT = 0x01;
const MAXIMUM_SIXTEEN_BITS_INTEGER = 65536;
// parseInt('10000000', 2) -> 128
const FIRST_BIT = 128;

const server = http
	.createServer((request, response) => {
		response.writeHead(200);
		response.end("Hello, World!");
	})
	.listen(PORT, () => console.log(`Running at http://localhost:${PORT}`));

server.on("upgrade", onSocketUpgrade);

function onSocketUpgrade(request, socket, head) {
	const { "sec-websocket-key": webClientSocketKey } = request.headers;
	console.log(`Client connected: ${webClientSocketKey}`);
	const headers = prepareHandshakeHeaders(webClientSocketKey);
	socket.write(headers);
	socket.on("readable", () => onSocketReadable(socket));
}

function onSocketReadable(socket) {
	socket.read(1);

	const [markerAndPayloadLength] = socket.read(1);
	// The first bit (mask indicator) is always 1 for client-server messages
	const lengthIndicatorInBits = markerAndPayloadLength - FIRST_BIT;

	let messageLength = 0;

	if (lengthIndicatorInBits <= SEVEN_BITS_INTEGER_MARKER) {
		messageLength = lengthIndicatorInBits;
	} else if (lengthIndicatorInBits === SIXTEEN_BITS_INTEGER_MARKER) {
		messageLength = socket.read(2).readUint16BE(0);
	} else if (lengthIndicatorInBits === SIXTY_FOUR_BITS_INTEGER_MARKER) {
	} else {
		throw new Error("Invalid message length");
	}

	const maskKey = socket.read(MASK_KEY_BYTES_LENGTH);
	const encodedMessage = socket.read(messageLength);
	const decodedMessage = unmaskMessage(encodedMessage, maskKey);
	const data = JSON.parse(decodedMessage.toString("utf-8"));
	console.log("Message received:", data);
	sendMessage(
		JSON.stringify({
			message: data,
			at: new Date().toISOString(),
		}),
		socket,
	);
}

function sendMessage(message, socket) {
	const dataFrame = prepareMessage(message);
	socket.write(dataFrame);
}

function prepareMessage(message) {
	const msg = Buffer.from(message);
	const messageSize = msg.length;

	let dataFrame;

	const firstByte = 0x80 | OPCODE_TEXT;
	if (messageSize <= SEVEN_BITS_INTEGER_MARKER) {
		const bytes = [firstByte, messageSize];
		dataFrame = Buffer.from(bytes);
	} else if (messageSize <= MAXIMUM_SIXTEEN_BITS_INTEGER) {
		const offset = 4; // Four bytes
		const target = Buffer.allocUnsafe(offset);
		target[0] = firstByte;
		target[1] = SIXTEEN_BITS_INTEGER_MARKER;
		target.writeUInt16BE(messageSize, 2);
		dataFrame = target;
	}

	const totalLength = dataFrame.byteLength + messageSize;
	const dataFrameResponse = concat([dataFrame, msg], totalLength);
	return dataFrameResponse;
}

function concat(bufferList, totalLength) {
	const target = Buffer.allocUnsafe(totalLength);
	let offset = 0;
	for (const buffer of bufferList) {
		target.set(buffer, offset);
		offset += buffer.length;
	}
	return target;
}

function unmaskMessage(encodedData, maskKey) {
	const finalBuffer = Buffer.from(encodedData);

	const fillWithEightZeros = (t) => t.padStart(8, "0");
	const toBinary = (t) => t.toString(2);
	const fromBinaryToDecimal = (t) => parseInt(t, 2);
	const getCharFromBinary = (t) => String.fromCharCode(t);

	for (let index = 0; index < encodedData.length; index++) {
		// XOR -> returns 1 if the bits are different, 0 if they are the same
		// (71).toString(2).padStart(8, "0") == 0 1 0 0 0 1 1 1
		// (53).toString(2).padStart(8, "0") == 0 0 1 1 0 1 0 1
		//															XOR  == 0 1 1 1 0 0 1 0 == 114
		finalBuffer[index] =
			encodedData[index] ^ maskKey[index % MASK_KEY_BYTES_LENGTH];
		// const logger = {
		// 	unmaskCalc: `${fillWithEightZeros(
		// 		toBinary(encodedData[index]),
		// 	)} ^ ${fillWithEightZeros(
		// 		toBinary(maskKey[index % MASK_KEY_BYTES_LENGTH]),
		// 	)} = ${fillWithEightZeros(toBinary(finalBuffer[index]))}`,
		// 	decoded: getCharFromBinary(
		// 		fromBinaryToDecimal(fillWithEightZeros(toBinary(finalBuffer[index]))),
		// 	),
		// };
		// console.log(logger);
	}
	return finalBuffer;
}

function prepareHandshakeHeaders(webClientSocketKey) {
	const acceptKey = generateWebSocketAccept(webClientSocketKey);
	const headers = [
		"HTTP/1.1 101 Switching Protocols",
		"Upgrade: websocket",
		"Connection: Upgrade",
		`Sec-WebSocket-Accept: ${acceptKey}`,
		"\r\n",
	].join("\r\n");
	return headers;
}

function generateWebSocketAccept(webClientSocketKey) {
	return crypto
		.createHash("sha1")
		.update(webClientSocketKey + WEBSOCKET_MAGIC_STRING)
		.digest("base64");
}

for (const event of ["uncaughtException", "unhandledRejection"]) {
	process.on(event, (error) => {
		console.error(`Event: ${event}`);
		console.error(`Error stack: ${error.stack}`);
	});
}
