/*
 * Covers patches/@agnoc+core+0.17.2.patch: mopping selected rooms when the water tank is attached.
 * The robot methods run on a fake robot with stubbed I/O, so only the commands sent are checked.
 */
require("should");
const sinon = require("sinon");
const { DeviceMode } = require("@agnoc/core/lib/value-objects/device-mode.value-object");
const { DeviceState } = require("@agnoc/core/lib/value-objects/device-state.value-object");
const { ID } = require("@agnoc/core/lib/value-objects/id.value-object");
const { Robot } = require("@agnoc/core/lib/emitters/robot.emitter");

const START = 1;
const STOP = 0;

function room(id, name) {
    const roomId = new ID(id);

    return {
        id: roomId,
        name: name,
        equals: (other) => {
            return other.id.value === id;
        },
    };
}

function fakeRobot({ hasMopAttached = false, mode = DeviceMode.VALUE.NONE, state = DeviceState.VALUE.DOCKED } = {}) {
    return Object.assign(Object.create(Robot.prototype), {
        device: {
            hasMopAttached: hasMopAttached,
            mode: new DeviceMode({ value: mode }),
            state: new DeviceState({ value: state }),
            system: { supports: () => {
                return true;
            } },
            map: {
                id: new ID(1695477360),
                rooms: [room(12, "Baño"), room(13, "Dormitorio")],
                restrictedZones: [],
            },
        },
        sendRecv: sinon.stub().resolves(),
        setMode: sinon.stub().resolves(),
        updateMap: sinon.stub().resolves(),
    });
}

function opcodes(robot) {
    return robot.sendRecv.getCalls().map((call) => {
        return call.args[0];
    });
}

describe("AgnocMopPatch", function () {
    describe("cleanRooms", function () {
        it("starts mopping the selected rooms when the mop is attached", async function () {
            const robot = fakeRobot({ hasMopAttached: true });

            await robot.cleanRooms([room(12, "Baño")]);

            opcodes(robot).should.deepEqual([
                "DEVICE_MAPID_SET_PLAN_PARAMS_REQ",
                "DEVICE_MAPID_SELECT_MAP_PLAN_REQ",
                "DEVICE_MAPID_GET_GLOBAL_INFO_REQ",
                "DEVICE_MOP_FLOOR_CLEAN_REQ",
            ]);
            robot.sendRecv.lastCall.args.should.deepEqual([
                "DEVICE_MOP_FLOOR_CLEAN_REQ", "DEVICE_MOP_FLOOR_CLEAN_RSP", { ctrlValue: START },
            ]);
            robot.sendRecv.firstCall.args[2].roomList.map((r) => {
                return r.enable;
            }).should.deepEqual([true, false]);
        });

        it("still vacuums when no mop is attached", async function () {
            const robot = fakeRobot();

            await robot.cleanRooms([room(12, "Baño")]);

            robot.sendRecv.lastCall.args.should.deepEqual([
                "DEVICE_AUTO_CLEAN_REQ", "DEVICE_AUTO_CLEAN_RSP", { ctrlValue: START, cleanType: 2 },
            ]);
        });
    });

    describe("start", function () {
        it("selects every room before a full mop while docked", async function () {
            const robot = fakeRobot({ hasMopAttached: true, mode: DeviceMode.VALUE.MOP });

            await robot.start();

            opcodes(robot).should.deepEqual(["DEVICE_MAPID_SET_PLAN_PARAMS_REQ", "DEVICE_MOP_FLOOR_CLEAN_REQ"]);
            robot.sendRecv.firstCall.args[2].roomList.map((r) => {
                return r.enable;
            }).should.deepEqual([true, true]);
            robot.sendRecv.lastCall.args[2].should.deepEqual({ ctrlValue: START });
        });

        it("resumes a paused mop without touching the plan", async function () {
            const robot = fakeRobot({ hasMopAttached: true, mode: DeviceMode.VALUE.MOP, state: DeviceState.VALUE.PAUSED });

            await robot.start();

            opcodes(robot).should.deepEqual(["DEVICE_MOP_FLOOR_CLEAN_REQ"]);
        });
    });

    describe("stop", function () {
        it("uses the mop command in mop mode", async function () {
            const robot = fakeRobot({ hasMopAttached: true, mode: DeviceMode.VALUE.MOP, state: DeviceState.VALUE.CLEANING });

            await robot.stop();

            robot.sendRecv.firstCall.args.should.deepEqual([
                "DEVICE_MOP_FLOOR_CLEAN_REQ", "DEVICE_MOP_FLOOR_CLEAN_RSP", { ctrlValue: STOP },
            ]);
        });

        it("uses the auto-clean command otherwise", async function () {
            const robot = fakeRobot({ state: DeviceState.VALUE.CLEANING });

            await robot.stop();

            robot.sendRecv.firstCall.args.should.deepEqual([
                "DEVICE_AUTO_CLEAN_REQ", "DEVICE_AUTO_CLEAN_RSP", { ctrlValue: STOP, cleanType: 2 },
            ]);
        });
    });
});
